"use strict";
var state = {
  score: null, hand: "R", baseDur: 48, dotted: false, chordMode: false, chordAnchorId: null,
  cursor: { R: 0, L: 0 }, selectedId: null, history: [], future: [],
  tupletMode: null, graceMode: false, pending: null, graceJustAdded: false
};
var HISTORY_MAX = 100;
function currentDur() { return state.dotted && state.baseDur !== 192 ? state.baseDur * 1.5 : state.baseDur; }
// 手の切替・曲の開閉・取り消し/やり直しのたびに、進行中の入力モードは持ち越さない
function clearModes() { state.pending = null; state.graceMode = false; state.tupletMode = null; state.graceJustAdded = false; }
// 3連符を組んでいる途中(tupletMode が生きたまま)で手や曲を切り替えると、未完成の組が
// 半端な長さのまま残ってしまう。mutate と同じ後始末(fixTuplets 以降)だけをその場で行い、
// 直しておく。ここでは undo スナップショットは積まない(音符自体は既に入っているので、
// これは記帳上の後始末に過ぎない)。呼び出し側の既存の render() が結果を反映する
function repairAbandonedTuplet() {
  if (!state.tupletMode || !state.score) return;
  fixTuplets(state.score);
  relayoutHand(state.score, "R"); relayoutHand(state.score, "L");
  pruneReferences(state.score);
  saveNow();
}

function mutate(fn) {
  if (Player.playing) stop();
  state.history.push(JSON.stringify(state.score));
  if (state.history.length > HISTORY_MAX) state.history.shift();
  state.future = [];
  fn();
  // fix 系は tick 順に依存するため、先に整列してから点検する(挿入直後は tick:0 のまま残っているため)
  relayoutHand(state.score, "R"); relayoutHand(state.score, "L");
  // 3連符を1個ずつ入れている最中(tupletMode が生きている間)は、まだ3個そろっていなくても
  // fixTuplets で普通の音符に戻さない。tupletMode が自動/手動で null になった時点で点検する
  if (!state.tupletMode) fixTuplets(state.score);
  // 装飾音を入れた直後の1回だけは fixGraces を見送る(まだ主音が続いていないだけなので)。
  // 次の mutate(通常は主音の入力)でこのフラグは即座に下ろし、そのときに改めて点検する
  var skipGraceFix = state.graceJustAdded; state.graceJustAdded = false;
  if (!skipGraceFix) fixGraces(state.score);
  relayoutHand(state.score, "R"); relayoutHand(state.score, "L");
  pruneReferences(state.score);
  saveNow(); render();
}
function insertEventAtCursor(ev) {
  var evs = handEvents(state.score, ev.hand);
  var idx = Math.min(state.cursor[ev.hand], evs.length);
  if (idx < evs.length) { var pos = state.score.events.indexOf(evs[idx]); state.score.events.splice(pos, 0, ev); }
  else state.score.events.push(ev);
  state.cursor[ev.hand] = idx + 1;
}
function makeEvent(hand, dur, notes, rest) {
  return { id: newId("e"), hand: hand, tick: 0, dur: dur, notes: notes, rest: rest, tie: false, grace: false, tuplet: null };
}
function findEvent(id) { return state.score.events.filter(function (e) { return e.id === id; })[0] || null; }

function addNote(midi) {
  Synth.ensure(); Synth.play(midi, 0.6);
  var sel0 = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel0 && state.graceMode && state.chordMode) { toast("和音モード中は装飾音を入れられません", true); return; }
  mutate(function () {
    var sel = state.selectedId ? findEvent(state.selectedId) : null;
    if (sel) {  // 選択中: 音を差し替える(和音モードなら重ねる)。装飾音モード中でも通常どおり差し替えて OFF にする
      if (state.chordMode) { if (!sel.notes.some(function (n) { return n.midi === midi; })) sel.notes.push({ midi: midi, acc: null }); }
      else sel.notes = [{ midi: midi, acc: null }];
      sel.rest = false; state.graceMode = false; return;
    }
    if (state.graceMode) {  // 装飾音: カーソル位置に24tickの小さい音符を入れて1回限りでOFF
      var g = makeEvent(state.hand, 24, [{ midi: midi, acc: null }], false);
      g.grace = true;
      insertEventAtCursor(g);
      state.graceMode = false; state.graceJustAdded = true; return;
    }
    var anchor = state.chordMode && state.chordAnchorId ? findEvent(state.chordAnchorId) : null;
    if (anchor && anchor.hand === state.hand) { if (!anchor.notes.some(function (n) { return n.midi === midi; })) anchor.notes.push({ midi: midi, acc: null }); return; }
    var dur = currentDur(), tuplet = null;
    if (state.tupletMode) { dur = TUPLET_OF[state.baseDur]; tuplet = { id: state.tupletMode.id, num: 3, in: 2 }; }
    var ev = makeEvent(state.hand, dur, [{ midi: midi, acc: null }], false);
    ev.tuplet = tuplet;
    insertEventAtCursor(ev);
    if (state.chordMode) state.chordAnchorId = ev.id;
    if (state.tupletMode) { state.tupletMode.remaining--; if (state.tupletMode.remaining <= 0) state.tupletMode = null; }
  });
  scrollToCursor();
}
function addRest() {
  mutate(function () {
    state.graceMode = false;  // 休符は装飾音になり得ないので、モードごと解除する
    var sel = state.selectedId ? findEvent(state.selectedId) : null;
    if (sel) { sel.rest = !sel.rest; if (sel.rest) sel.notes = []; return; }
    var dur = currentDur(), tuplet = null;
    if (state.tupletMode) { dur = TUPLET_OF[state.baseDur]; tuplet = { id: state.tupletMode.id, num: 3, in: 2 }; }
    var ev = makeEvent(state.hand, dur, [], true);
    ev.tuplet = tuplet;
    insertEventAtCursor(ev);
    state.chordAnchorId = null;
    if (state.tupletMode) { state.tupletMode.remaining--; if (state.tupletMode.remaining <= 0) state.tupletMode = null; }
  });
  scrollToCursor();
}
function setDuration(ticks) {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  var info = durationInfo(ticks);
  if (!info) return;
  if (sel) {
    if (sel.tuplet) {
      var td = TUPLET_OF[ticks];
      if (td === undefined) { toast("3連符は4分・8分・16分で使えます", true); return; }
      mutate(function () {
        var tid = sel.tuplet.id;
        state.score.events.forEach(function (e) { if (e.tuplet && e.tuplet.id === tid) e.dur = td; });
      });
      return;
    }
    mutate(function () { sel.dur = ticks; }); return;
  }
  state.baseDur = ticks; if (ticks === 192) state.dotted = false;
  renderToolbarState();
}
function setTupletMode(on) {
  if (on) {
    if (TUPLET_OF[state.baseDur] === undefined) { toast("3連符は4分・8分・16分で使えます", true); return; }
    state.tupletMode = { id: newId("t"), remaining: 3 };
    renderToolbarState();
  } else if (state.tupletMode) {
    // 途中でOFFにした: 3個そろっていない組は普通の音符に戻す(fixTupletsをすぐ走らせる)
    mutate(function () { state.tupletMode = null; });
  } else {
    renderToolbarState();
  }
}
function setGraceMode(on) { state.graceMode = on; renderToolbarState(); }
function setDotted(on) {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (sel) {
    if (sel.tuplet) { toast("3連符には付点を付けられません", true); return; }
    var base = durationInfo(sel.dur);
    if (!base) return;
    var b = base.dots ? sel.dur / 1.5 : sel.dur; var nd = on ? (b === 192 ? 192 : b * 1.5) : b; if (durationInfo(nd)) mutate(function () { sel.dur = nd; }); return;
  }
  state.dotted = on && state.baseDur !== 192; renderToolbarState();
}
function setHand(h) { repairAbandonedTuplet(); state.hand = h; state.chordAnchorId = null; state.selectedId = null; clearModes(); render(); scrollKeyboardTo(h === "R" ? 60 : 48); }
function toggleHand() { setHand(state.hand === "R" ? "L" : "R"); }
function setChordMode(on) { state.chordMode = on; state.chordAnchorId = null; renderToolbarState(); }
function setRestMode() { addRest(); }

function select(id) {
  if (id && !findEvent(id)) return;
  if (state.pending) {
    var pend = state.pending;
    if (!id || id === pend.from) {
      state.pending = null;
      toast("取り消しました", true);
    } else {
      var from = findEvent(pend.from), to = findEvent(id);
      if (!from || !to || from.rest || from.grace || to.rest || to.grace) {
        toast("音符を選んでください", true);
        state.pending = null;
      } else if (from.tick === to.tick) {
        // 同じ拍(タイミング)の組は前後関係が決められない(pruneReferences が黙って消してしまうので、ここで弾く)
        toast("同時に鳴る音符どうしには付けられません", true);
        state.pending = null;
      } else if (pend.kind === "slur" && from.hand !== to.hand) {
        toast("同じ手の音符を選んでください", true);
        state.pending = null;
      } else {
        var a = from, b = to;
        if (a.tick > b.tick) { var tmp = a; a = b; b = tmp; }
        var arrName = pend.kind === "slur" ? "slurs" : "pedals";
        mutate(function () { state.score[arrName].push({ from: a.id, to: b.id }); });
        state.pending = null;
        id = b.id;
      }
    }
  }
  if (state.selectedId === id) id = null;
  state.selectedId = id;
  state.chordAnchorId = null;
  if (id) {
    var ev = findEvent(id); state.hand = ev.hand;
    state.cursor[ev.hand] = handEvents(state.score, ev.hand).indexOf(ev) + 1;
  }
  render();
  if (id) {
    var g = document.getElementById("vf-" + id);
    if (g) {
      var wrap = $("scoreWrap"), r = g.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      if (r.top < wr.top || r.bottom > wr.bottom) g.scrollIntoView({ block: "center" });
    }
  }
}
// スラー・ペダルの開始/トグル: 選択中の非休符イベントが要る。既にそのイベント発のスラー/ペダルがあれば削除(トグル)
function startPending(kind) {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel || sel.rest) { toast("先に音符をタップして選んでください", true); return; }
  if (sel.grace) { toast("装飾音には付けられません", true); return; }
  var arrName = kind === "slur" ? "slurs" : "pedals";
  var existing = state.score[arrName].filter(function (r) { return r.from === sel.id; })[0];
  if (existing) {
    mutate(function () {
      var arr = state.score[arrName], idx = arr.indexOf(existing);
      if (idx >= 0) arr.splice(idx, 1);
    });
    return;
  }
  state.pending = { kind: kind, from: sel.id };
  renderToolbarState();
  toast(kind === "slur" ? "スラーの終わりの音符をタップ" : "ペダルの終わりの音符をタップ", true);
}
function startSlur() { startPending("slur"); }
function startPedal() { startPending("pedal"); }
function setDynamic(text) {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel || sel.rest) { toast("先に音符をタップして選んでください", true); return; }
  if (sel.grace) { toast("装飾音には付けられません", true); return; }
  mutate(function () {
    var idx = -1;
    state.score.dynamics.forEach(function (d, i) { if (d.eventId === sel.id) idx = i; });
    if (idx >= 0) state.score.dynamics.splice(idx, 1);
    if (text) state.score.dynamics.push({ eventId: sel.id, text: text });
  });
}
function setRepeat(kind) {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel) { toast("先に音符をタップして選んでください", true); return; }
  var m = measureIndexOf(state.score, sel.tick);
  if (kind === "start") {
    if (state.score.repeats.some(function (r) { return r.startMeasure === m; })) return;
    mutate(function () { state.score.repeats.push({ startMeasure: m, endMeasure: null }); });
  } else if (kind === "end") {
    var candidates = state.score.repeats.filter(function (r) { return r.endMeasure == null && r.startMeasure <= m; });
    if (!candidates.length) { toast("先に「繰り返し始め」を置いてください", true); return; }
    // 直近の(最も近い=startMeasureが最大の)始めを完成させる。入力順ではない
    var target = candidates.reduce(function (best, r) { return (!best || r.startMeasure > best.startMeasure) ? r : best; }, null);
    mutate(function () { target.endMeasure = m; });
  }
}
function clearRepeat() {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel) { toast("先に音符をタップして選んでください", true); return; }
  var m = measureIndexOf(state.score, sel.tick);
  mutate(function () {
    state.score.repeats = state.score.repeats.filter(function (r) { return r.startMeasure !== m && r.endMeasure !== m; });
  });
}
function deleteSelected() {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel) {  // 選択なし: カーソル直前の事象を消す(Backspace の感覚)
    var evs = handEvents(state.score, state.hand), i = state.cursor[state.hand] - 1;
    if (i < 0) return;
    sel = evs[i];
  }
  mutate(function () {
    var evs = handEvents(state.score, sel.hand), i = evs.indexOf(sel);
    state.score.events.splice(state.score.events.indexOf(sel), 1);
    state.cursor[sel.hand] = i; state.selectedId = null; state.chordAnchorId = null;
  });
}
function setAccidental(acc) {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel || sel.rest) { toast("先に音符をタップして選んでください", true); return; }
  mutate(function () {
    sel.notes.forEach(function (n) { applyAccidental(n, acc, state.score.keySig); });
  });
}
function toggleTie() {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel || sel.rest) { toast("先に音符をタップして選んでください", true); return; }
  if (sel.grace) { toast("装飾音には付けられません", true); return; }
  mutate(function () { sel.tie = !sel.tie; });
}
function moveCursorToEnd() { state.selectedId = null; state.chordAnchorId = null; state.cursor[state.hand] = handEvents(state.score, state.hand).length; render(); scrollToCursor(); }
function undo() {
  if (!state.history.length) return;
  state.future.push(JSON.stringify(state.score));
  state.score = normalizeScore(JSON.parse(state.history.pop()));
  state.selectedId = null; state.chordAnchorId = null; clearModes(); clampCursor(); saveNow(); render();
}
function redo() {
  if (!state.future.length) return;
  state.history.push(JSON.stringify(state.score));
  state.score = normalizeScore(JSON.parse(state.future.pop()));
  state.selectedId = null; state.chordAnchorId = null; clearModes(); clampCursor(); saveNow(); render();
}
function clampCursor() { ["R", "L"].forEach(function (h) { state.cursor[h] = Math.min(state.cursor[h], handEvents(state.score, h).length); }); }

function updateSettings(patch) {
  mutate(function () {
    var s = state.score;
    if (typeof patch.title === "string" && patch.title.trim()) s.title = patch.title.trim();
    if (typeof patch.composer === "string") s.composer = patch.composer.trim();
    if (patch.bpm != null) s.bpm = Math.min(240, Math.max(30, Math.round(Number(patch.bpm) || s.bpm)));
    if (patch.timeSig && TIME_SIGS.some(function (t) { return t.beats === patch.timeSig.beats && t.unit === patch.timeSig.unit; })) s.timeSig = { beats: patch.timeSig.beats, unit: patch.timeSig.unit };
    if (patch.keySig) s.keySig = keySigInfo(patch.keySig).name;
    if (patch.showDoremi) s.showDoremi = { screen: !!patch.showDoremi.screen, print: !!patch.showDoremi.print };
  });
  if (patch.bpm != null) setPlayBpm(state.score.bpm);
}

function openScoreObject(s) {
  repairAbandonedTuplet();  // 曲を切り替える前に、放棄する側(旧 state.score)の未完成の組を直しておく
  state.score = s; state.selectedId = null; state.chordAnchorId = null; clearModes();
  state.cursor = { R: handEvents(s, "R").length, L: handEvents(s, "L").length };
  state.history = []; state.future = [];
  setLastOpen(s.id); render();
  setPlayBpm(s.bpm); if (Player.playing) stop();
}

function newScoreAction() { var s = newScore(); saveScore(s); openScoreObject(s); $("dlgList").close(); }
function openScore(id) { var s = loadScore(id); if (!s) { toast("その曲は開けませんでした"); return; } openScoreObject(s); $("dlgList").close(); }
function duplicateScore(id) {
  var s = loadScore(id); if (!s) { toast("その曲は開けませんでした"); return; }
  s.id = newId("s"); s.title = s.title + " のコピー"; s.createdAt = new Date().toISOString();
  reissueEventIds(s);
  saveScore(s); openScoreObject(s); $("dlgList").close();
}
function deleteScore(id) {
  var meta = listScores().filter(function (x) { return x.id === id; })[0];
  if (!confirm("「" + (meta ? meta.title : "") + "」を削除します。元に戻せません。よいですか?")) return;
  deleteScoreData(id);
  if (state.score.id === id) {
    var rest = listScores(); var s = rest.length ? loadScore(rest[0].id) : null;
    if (!s) { s = newScore(); saveScore(s); }
    openScoreObject(s);
  }
  renderList();
}
