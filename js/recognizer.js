"use strict";
// 演奏認識(部品の読み込み・カウント付き録音・Basic Pitch 解析)。
// ブラウザ専用(Node export なし)。index.html には書かず、必要になったら app.js が
// <script src="js/recognizer.js"> を動的に差し込んで使う。

// 注: opts.onError(録音セットアップ失敗を呼び出し側へ通知するフック)と、
// setTestStream/_testStream/analyzeRaw(getUserMedia の代わりに MediaStream を注入する・整形前の生出力を返す)は
// アプリの通常経路では使わないが、動作確認・自動テストのために意図して残してある公開APIです。
var Recognizer = {
  bp: null,
  _loadPromise: null,
  _testStream: null,

  // 検証用: getUserMedia の代わりにこの MediaStream を使う
  setTestStream: function (stream) { this._testStream = stream; },

  // vendor/basic-pitch.js を読み込み、モデルの準備ができるまで待つ(1回だけ・冪等)
  load: function (onProgress) {
    var self = this;
    // 進捗の通知先は「最新の呼び出し」のものを使う(ダイアログを開いた時点の先読みは引数なしで呼ばれ、
    // 録音開始時の呼び出しで差し替わる)。差し替え時は直近の文をすぐ再送して、画面の文が固まらないようにする
    if (onProgress) { this._progressCb = onProgress; if (this._lastProgress) onProgress(this._lastProgress); }
    if (this._loadPromise) return this._loadPromise;
    function report(text) { self._lastProgress = text; if (self._progressCb) self._progressCb(text); }
    var injectedScript = null;
    this._loadPromise = (function () {
      function afterScriptReady() {
        report("モデルを準備中");
        self.bp = new BasicPitchLib.BasicPitch("vendor/basic-pitch-model/model.json");
        return Promise.resolve(self.bp.model).then(function (m) { self._lastProgress = null; return m; });
      }
      var p;
      if (window.BasicPitchLib) {
        p = afterScriptReady();
      } else {
        report("部品を読み込み中(初回のみ約2MB)");
        p = new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = "vendor/basic-pitch.js";
          injectedScript = s;
          s.onload = function () { afterScriptReady().then(resolve, reject); };
          s.onerror = function () { reject(new Error("script load error")); };
          document.head.appendChild(s);
        });
      }
      return p.catch(function (err) {
        var e = new Error("認識部品を読み込めませんでした");
        e.cause = err;
        throw e;
      });
    })();
    // 失敗した場合は注入した <script> を取り除いてから、次回また読み込み直せるようにキャッシュを捨てる
    this._loadPromise.catch(function () {
      if (injectedScript && injectedScript.parentNode) {
        injectedScript.parentNode.removeChild(injectedScript);
      }
      self._loadPromise = null;
    });
    return this._loadPromise;
  },

  // 録音(カウント付き)。opts = { bpm, beats, unit=4, maxSec=60, onCount, onRecording, onAutoStop, onError }
  // 戻り値: { stop(): Promise<Float32Array (22050Hz)> }
  record: function (opts) {
    opts = opts || {};
    var bpm = opts.bpm || 90;
    var beats = opts.beats || 4;
    var unit = opts.unit || 4;
    var maxSec = opts.maxSec != null ? opts.maxSec : 60;
    var onCount = opts.onCount || function () {};
    var onRecording = opts.onRecording || function () {};
    var onAutoStop = opts.onAutoStop || function () {};

    var state = {
      stopped: false,
      finished: false,
      captureStarted: false,
      startWallTime: 0,
      lastBlockRms: 0,
      chunks: [],
      timers: [],
      autoStopTimer: null,
      progressTimer: null,
      stream: null,
      ctx: null,
      src: null,
      workletNode: null,
      scriptNode: null,
      muteGain: null
    };

    var resolveStopPromise;
    var stopPromise = new Promise(function (resolve) { resolveStopPromise = resolve; });
    var readySettled = false;
    var resolveReady, rejectReady;
    var readyPromise = new Promise(function (resolve, reject) {
      // ready は resolve/reject どちらか一度きりで確定させる(以降の呼び出しは無視する)。
      // これで stopInternal() 側からも安全に「未確定なら reject」を行える
      resolveReady = function () { if (readySettled) return; readySettled = true; resolve(); };
      rejectReady = function (e) { if (readySettled) return; readySettled = true; reject(e); };
    });

    // getUserMedia / AudioContext のエラーを、利用者向けの日本語メッセージに変換する(name は保持)
    function mapSetupError(err) {
      var name = err && err.name;
      var out;
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
        out = new Error("マイクが使えません。設定でマイクを許可してください");
        out.name = name;
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        out = new Error("マイクが見つかりません");
        out.name = name;
      } else if (name === "NotSupportedError") {
        out = new Error("この画面ではマイクが使えません");
        out.name = name;
      } else if (err && err._recognizerKind === "context-not-running") {
        out = new Error("音の準備ができませんでした。もう一度お試しください");
        out.name = name || "NotRunningError";
      } else {
        out = new Error("録音を始められませんでした");
        if (name) out.name = name;
      }
      out.cause = err;
      return out;
    }

    function clearTimers() {
      state.timers.forEach(function (t) { clearTimeout(t); });
      state.timers = [];
      if (state.autoStopTimer != null) { clearTimeout(state.autoStopTimer); state.autoStopTimer = null; }
      if (state.progressTimer != null) { clearInterval(state.progressTimer); state.progressTimer = null; }
    }

    function resampleLinear(input, fromRate, toRate) {
      if (!input.length || fromRate === toRate) return input;
      var ratio = fromRate / toRate;
      var outLen = Math.max(0, Math.round(input.length / ratio));
      var out = new Float32Array(outLen);
      for (var i = 0; i < outLen; i++) {
        var srcPos = i * ratio;
        var idx = Math.floor(srcPos);
        var frac = srcPos - idx;
        var a = idx < input.length ? input[idx] : 0;
        var b = (idx + 1) < input.length ? input[idx + 1] : a;
        out[i] = a + (b - a) * frac;
      }
      return out;
    }

    function teardownAudioNodes() {
      try { if (state.workletNode) state.workletNode.disconnect(); } catch (e) {}
      try { if (state.scriptNode) state.scriptNode.disconnect(); } catch (e) {}
      try { if (state.muteGain) state.muteGain.disconnect(); } catch (e) {}
      try { if (state.src) state.src.disconnect(); } catch (e) {}
      if (state.stream) {
        state.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      }
    }

    function finishStop() {
      if (state.finished) return;
      state.finished = true;
      clearTimers();
      teardownAudioNodes();
      var sr = state.ctx ? state.ctx.sampleRate : 22050;
      var total = 0;
      state.chunks.forEach(function (c) { total += c.length; });
      var merged = new Float32Array(total);
      var off = 0;
      state.chunks.forEach(function (c) { merged.set(c, off); off += c.length; });
      var resampled = resampleLinear(merged, sr, 22050);
      function done() { resolveStopPromise(resampled); }
      if (state.ctx && state.ctx.state !== "closed") {
        state.ctx.close().then(done, done);
      } else {
        done();
      }
    }

    // AudioWorklet が無い環境(古い Safari 等)、または Worklet の準備に失敗した環境向けのフォールバック
    function useScriptProcessor(ctx, captureStart) {
      var script = ctx.createScriptProcessor(4096, 1, 1);
      state.scriptNode = script;
      script.onaudioprocess = function (ev) {
        handleBlock(ctx, captureStart, ev.inputBuffer.getChannelData(0).slice());
      };
      var muteGain = ctx.createGain();
      muteGain.gain.value = 0;
      state.muteGain = muteGain;
      state.src.connect(script);
      script.connect(muteGain);
      muteGain.connect(ctx.destination);
    }

    function handleBlock(ctx, captureStart, block) {
      if (state.stopped || ctx.currentTime < captureStart) return;
      if (!state.captureStarted) {
        state.captureStarted = true;
        state.startWallTime = ctx.currentTime;
        resolveReady();
      }
      state.chunks.push(block);
      var sum = 0;
      for (var k = 0; k < block.length; k++) sum += block[k] * block[k];
      state.lastBlockRms = Math.sqrt(sum / block.length);
    }

    var streamPromise = this._testStream ? Promise.resolve(this._testStream) :
      (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) ?
        Promise.reject(Object.assign(new Error("no getUserMedia"), { name: "NotSupportedError" })) :
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });

    var setupPromise = streamPromise.then(function (stream) {
      if (state.stopped) {
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        return;
      }
      state.stream = stream;
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC();
      state.ctx = ctx;
      state.src = ctx.createMediaStreamSource(stream);

      // iOS ではユーザー操作の外で作った AudioContext が suspended のまま時計が進まないため、
      // カウントや集音開始時刻(captureStart)を計算する前に必ず resume して実行中であることを確認する
      return Promise.resolve()
        .then(function () { return ctx.resume(); })
        .catch(function () { /* resume 自体の失敗は下の state チェックで拾う */ })
        .then(function () {
          if (state.stopped) return;
          if (ctx.state !== "running") {
            var notRunning = new Error("audio context did not resume");
            notRunning._recognizerKind = "context-not-running";
            throw notRunning;
          }

          // (1) カウント: beats 回のクリック。60/bpm 秒 × 4/unit(拍子の分母)間隔、開始は集音開始準備の約0.1秒後
          // (例: 6/8 なら unit=8 で 8分音符6個=1小節分のカウントになる)
          var beatSec = (60 / bpm) * (4 / unit);
          var startAt = ctx.currentTime + 0.1;
          for (var i = 0; i < beats; i++) {
            (function (i) {
              var clickTime = startAt + i * beatSec;
              var remaining = beats - i;
              var osc = ctx.createOscillator();
              var gain = ctx.createGain();
              osc.frequency.value = i === 0 ? 1500 : 1000;
              gain.gain.value = 0.3;
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start(clickTime);
              osc.stop(clickTime + 0.03);
              var delayMs = Math.max(0, (clickTime - ctx.currentTime) * 1000);
              state.timers.push(setTimeout(function () {
                if (!state.stopped) onCount(remaining);
              }, delayMs));
            })(i);
          }
          // (2) 最後のクリックの1拍後(=カウント開始から beats 拍後)を集音の t=0 とする
          var captureStart = startAt + beats * beatSec;

          // maxSec 到達で自動停止
          var autoStopMs = Math.max(0, (captureStart + maxSec - ctx.currentTime) * 1000);
          state.autoStopTimer = setTimeout(function () {
            if (state.stopped) return;
            onAutoStop();
            stopInternal();
          }, autoStopMs);

          // 100ms ごとに経過秒と直近ブロックの RMS を通知
          state.progressTimer = setInterval(function () {
            if (state.stopped || !state.captureStarted) return;
            onRecording(ctx.currentTime - state.startWallTime, state.lastBlockRms);
          }, 100);

          if (ctx.audioWorklet) {
            var processorCode =
              "class RecProcessor extends AudioWorkletProcessor {" +
              "  process(inputs) {" +
              "    var ch = inputs[0] && inputs[0][0];" +
              "    if (ch && ch.length) this.port.postMessage(ch.slice());" +
              "    return true;" +
              "  }" +
              "}" +
              "registerProcessor('rec-processor', RecProcessor);";
            var blobUrl = URL.createObjectURL(new Blob([processorCode], { type: "application/javascript" }));
            return ctx.audioWorklet.addModule(blobUrl).then(function () {
              URL.revokeObjectURL(blobUrl);
              if (state.stopped) return;
              var node = new AudioWorkletNode(ctx, "rec-processor");
              state.workletNode = node;
              node.port.onmessage = function (ev) { handleBlock(ctx, captureStart, ev.data); };
              var muteGain = ctx.createGain();
              muteGain.gain.value = 0;
              state.muteGain = muteGain;
              state.src.connect(node);
              node.connect(muteGain);
              muteGain.connect(ctx.destination);
            }).catch(function () {
              // addModule 自体の失敗・AudioWorkletNode 生成の失敗など、Worklet が使えない場合は
              // ScriptProcessor にフォールバックする(フロー全体を失敗させない)
              URL.revokeObjectURL(blobUrl);
              if (!state.stopped) useScriptProcessor(ctx, captureStart);
            });
          } else {
            useScriptProcessor(ctx, captureStart);
          }
        });
    });

    setupPromise.then(function () {}, function (err) {
      // 録音開始の準備に失敗: 呼び出し側へ日本語メッセージで通知し、後始末する
      var mapped = mapSetupError(err);
      rejectReady(mapped);
      if (opts.onError) { try { opts.onError(mapped); } catch (e) {} }
      if (!state.stopped) {
        state.stopped = true;
        teardownAudioNodes();
        if (state.ctx && state.ctx.state !== "closed") {
          try { state.ctx.close(); } catch (e) {}
        }
        state.finished = true;
        clearTimers();
        resolveStopPromise(new Float32Array(0));
      }
    });

    function stopInternal() {
      if (state.stopped) return stopPromise;
      state.stopped = true;
      // 最初の集音ブロックが来る前に停止された場合、ready はどちらにも確定せず
      // 呼び出し側が永遠に待ってしまう。ここでまだ確定していなければ「取り消し」として reject する
      if (!readySettled) {
        rejectReady(Object.assign(new Error("録音を取り消しました"), { name: "AbortError" }));
      }
      setupPromise.catch(function () {}).then(finishStop);
      return stopPromise;
    }

    return { stop: stopInternal, ready: readyPromise };
  },

  // 生の Basic Pitch 検出結果(未整形)。テスト用に公開
  analyzeRaw: function (pcm, onProgress) {
    var self = this;
    return this.load().then(function () {
      return new Promise(function (resolve, reject) {
        var frames = [], onsets = [], contours = [];
        var hintShown = false;
        var slowTimer = setTimeout(function () {
          if (hintShown) return;
          hintShown = true;
          if (onProgress) onProgress("初回は準備に時間がかかります(20秒ほど)");
        }, 3000);

        function clearSlowTimer() {
          if (slowTimer != null) { clearTimeout(slowTimer); slowTimer = null; }
        }

        function percentCallback(p) {
          var percent = Math.round((p || 0) * 100);
          // 初回の 0% 通知では止めない(その後 3 秒たっても進捗が無ければ案内を出したいため)。
          // 実際に進捗が来たとき(>0)だけタイマーを止める。
          if (percent > 0) clearSlowTimer();
          if (onProgress) onProgress(percent);
        }
        function onComplete(f, o, c) {
          if (f && f.length) Array.prototype.push.apply(frames, f);
          if (o && o.length) Array.prototype.push.apply(onsets, o);
          if (c && c.length) Array.prototype.push.apply(contours, c);
        }

        // evaluateModel は推論の中間テンソルを大量に作る。load() でモデルの重みを作った
        // 外側のスコープのまま呼ぶと、そのテンソルたちが解放されず溜まり続ける(メモリリーク)ので、
        // ここだけ専用のスコープで囲み、成功・失敗どちらの経路でも必ず閉じる
        BasicPitchLib.tf.engine().startScope();
        self.bp.evaluateModel(pcm, onComplete, percentCallback).then(function () {
          BasicPitchLib.tf.engine().endScope();
          clearSlowTimer();
          try {
            var notes = BasicPitchLib.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5);
            notes = BasicPitchLib.addPitchBendsToNoteEvents(contours, notes);
            notes = BasicPitchLib.noteFramesToTime(notes);
            resolve(notes);
          } catch (err) {
            reject(new Error("解析に失敗しました"));
          }
        }).catch(function () {
          BasicPitchLib.tf.engine().endScope();
          clearSlowTimer();
          reject(new Error("解析に失敗しました"));
        });
      });
    });
  },

  // 整形済み(cleanRecognizedNotes 適用後)の検出結果
  analyze: function (pcm, onProgress) {
    return this.analyzeRaw(pcm, onProgress).then(function (notes) {
      return cleanRecognizedNotes(notes);
    });
  }
};
