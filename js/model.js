"use strict";
var FORMAT_VERSION = 1;
var TPQ = 48;
var DURATIONS = [
  { ticks: 192, vf: "w",  dots: 0, label: "全" },
  { ticks: 144, vf: "h",  dots: 1, label: "付点2分" },
  { ticks: 96,  vf: "h",  dots: 0, label: "2分" },
  { ticks: 72,  vf: "q",  dots: 1, label: "付点4分" },
  { ticks: 48,  vf: "q",  dots: 0, label: "4分" },
  { ticks: 36,  vf: "8",  dots: 1, label: "付点8分" },
  { ticks: 32,  vf: "q",  dots: 0, label: "4分3連", tuplet: true },
  { ticks: 24,  vf: "8",  dots: 0, label: "8分" },
  { ticks: 18,  vf: "16", dots: 1, label: "付点16分" },
  { ticks: 16,  vf: "8",  dots: 0, label: "8分3連", tuplet: true },
  { ticks: 12,  vf: "16", dots: 0, label: "16分" },
  { ticks: 8,   vf: "16", dots: 0, label: "16分3連", tuplet: true }
];
var KEY_SIGS = [
  { name: "C",  label: "ハ長調",   sharps: 0, flats: 0 },
  { name: "G",  label: "ト長調",   sharps: 1, flats: 0 },
  { name: "D",  label: "ニ長調",   sharps: 2, flats: 0 },
  { name: "F",  label: "ヘ長調",   sharps: 0, flats: 1 },
  { name: "Bb", label: "変ロ長調", sharps: 0, flats: 2 },
  { name: "Am", label: "イ短調",   sharps: 0, flats: 0 },
  { name: "Em", label: "ホ短調",   sharps: 1, flats: 0 },
  { name: "Bm", label: "ロ短調",   sharps: 2, flats: 0 },
  { name: "Dm", label: "ニ短調",   sharps: 0, flats: 1 },
  { name: "Gm", label: "ト短調",   sharps: 0, flats: 2 }
];
var TIME_SIGS = [
  { beats: 4, unit: 4 }, { beats: 3, unit: 4 }, { beats: 2, unit: 4 }, { beats: 6, unit: 8 }
];
var SHARP_ORDER = ["f", "c", "g", "d", "a", "e", "b"];
var FLAT_ORDER  = ["b", "e", "a", "d", "g", "c", "f"];
var LETTERS = ["c", "d", "e", "f", "g", "a", "b"];
var LETTER_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
var DOREMI = { c: "ド", d: "レ", e: "ミ", f: "ファ", g: "ソ", a: "ラ", b: "シ" };

function newId(prefix) {
  return (prefix || "e") + "_" + Math.random().toString(36).slice(2, 10);
}
function nowIso() { return new Date().toISOString(); }

function newScore(title) {
  var t = nowIso();
  return {
    format: "piano-fusen", version: FORMAT_VERSION, id: newId("s"),
    title: title || "新しい曲", composer: "", bpm: 90,
    timeSig: { beats: 4, unit: 4 }, keySig: "C",
    showDoremi: { screen: true, print: true },
    events: [], slurs: [], dynamics: [], pedals: [], repeats: [],
    createdAt: t, updatedAt: t
  };
}

function keySigInfo(name) {
  for (var i = 0; i < KEY_SIGS.length; i++) if (KEY_SIGS[i].name === name) return KEY_SIGS[i];
  return KEY_SIGS[0];
}
function measureTicks(ts) { return ts.beats * (4 / ts.unit) * TPQ; }
function durationInfo(ticks) {
  for (var i = 0; i < DURATIONS.length; i++) if (DURATIONS[i].ticks === ticks) return DURATIONS[i];
  return null;
}
function handEvents(score, hand) {
  return score.events.filter(function (e) { return e.hand === hand; })
    .sort(function (a, b) { return a.tick - b.tick; });
}
// 同じ手の事象を「events配列内の出現順」で隙間なく並べ直す
function relayoutHand(score, hand) {
  var t = 0;
  score.events.forEach(function (e) {
    if (e.hand !== hand) return;
    e.tick = t; t += e.grace ? 0 : e.dur;
  });
  return t;
}
function deriveMeasures(score) {
  var mt = measureTicks(score.timeSig);
  var R = handEvents(score, "R"), L = handEvents(score, "L");
  var endR = R.length ? R[R.length - 1].tick + R[R.length - 1].dur : 0;
  var endL = L.length ? L[L.length - 1].tick + L[L.length - 1].dur : 0;
  var total = Math.max(endR, endL, 1);
  var count = Math.ceil(total / mt);
  var measures = [];
  for (var m = 0; m < count; m++) {
    measures.push({ index: m, startTick: m * mt, endTick: (m + 1) * mt, R: [], L: [], warn: { R: false, L: false } });
  }
  function place(list, hand) {
    list.forEach(function (e) {
      var m = Math.floor(e.tick / mt);
      var mea = measures[m];
      mea[hand].push(e);
      if (!e.grace && e.tick + e.dur > mea.endTick) mea.warn[hand] = true;
    });
  }
  place(R, "R"); place(L, "L");
  return measures;
}
// keySig で♯/♭になる文字の集合
function keyAlterations(keySig) {
  var k = keySigInfo(keySig), alt = {};
  for (var i = 0; i < k.sharps; i++) alt[SHARP_ORDER[i]] = "#";
  for (var j = 0; j < k.flats; j++) alt[FLAT_ORDER[j]] = "b";
  return alt;
}
function spellMidi(midi, keySig, acc) {
  var pc = ((midi % 12) + 12) % 12;
  var k = keySigInfo(keySig);
  var preferFlat = k.flats > 0;
  var alt = keyAlterations(keySig);
  var letter, accidental;
  var natural = null;
  for (var i = 0; i < LETTERS.length; i++) if (LETTER_PC[LETTERS[i]] === pc) natural = LETTERS[i];
  if (acc === "#" || (acc == null && natural == null && !preferFlat)) {
    for (var a = 0; a < LETTERS.length; a++) if (((LETTER_PC[LETTERS[a]] + 1) % 12) === pc) letter = LETTERS[a];
    accidental = "#";
  } else if (acc === "b" || (acc == null && natural == null && preferFlat)) {
    for (var b = 0; b < LETTERS.length; b++) if (((LETTER_PC[LETTERS[b]] + 11) % 12) === pc) letter = LETTERS[b];
    accidental = "b";
  } else {
    letter = natural; accidental = acc === "n" ? "n" : "";
    // 調号で変化する文字が白鍵の音として出たら、♮を明示
    if (acc == null && alt[letter]) accidental = "n";
    if (letter == null) {
      // 黒鍵に♮が保存されていた古いデータ用の保険: ♯(調号が♭系なら♭)綴りへ逃がして letter が null にならないようにする
      if (preferFlat) {
        for (var fb = 0; fb < LETTERS.length; fb++) if (((LETTER_PC[LETTERS[fb]] + 11) % 12) === pc) letter = LETTERS[fb];
        accidental = "b";
      } else {
        for (var fs = 0; fs < LETTERS.length; fs++) if (((LETTER_PC[LETTERS[fs]] + 1) % 12) === pc) letter = LETTERS[fs];
        accidental = "#";
      }
    }
  }
  // 調号でカバーされる音は臨時記号を空にする(applyAccidentalsが判断できるよう vfKey には残す)
  var octave = Math.floor(midi / 12) - 1;
  if (accidental === "#" && letter === "b") octave -= 1;   // b#/3 は midi 60
  if (accidental === "b" && letter === "c") octave += 1;   // cb/5 は midi 71
  var vfKey = letter + (accidental === "n" ? "n" : accidental) + "/" + octave;
  var dore = DOREMI[letter] + (accidental === "#" ? "♯" : accidental === "b" ? "♭" : "");
  return { letter: letter, accidental: accidental, octave: octave, vfKey: vfKey, doremi: dore };
}
function doremiOf(midi, keySig, acc) { return spellMidi(midi, keySig, acc).doremi; }

// 臨時記号ボタンを1音に適用する。表示中の臨時記号と同じボタンなら外して自然音へ戻す
function applyAccidental(note, acc, keySig) {
  var sp = spellMidi(note.midi, keySig, note.acc);
  var shown = sp.accidental;                         // "" | "#" | "b" | "n"
  var white = (shown === "" || shown === "n");
  if (acc === "#") {
    if (shown === "#") { note.midi -= 1; note.acc = null; }        // ♯を外す → 自然音
    else if (white)    { note.midi += 1; note.acc = "#"; }
    else               { note.midi += 2; note.acc = "#"; }         // ♭の音に♯
  } else if (acc === "b") {
    if (shown === "b") { note.midi += 1; note.acc = null; }
    else if (white)    { note.midi -= 1; note.acc = "b"; }
    else               { note.midi -= 2; note.acc = "b"; }         // ♯の音に♭
  } else {                                                          // "n"
    if (shown === "#")      { note.midi -= 1; note.acc = "n"; }
    else if (shown === "b") { note.midi += 1; note.acc = "n"; }
    else if (shown === "n") { note.acc = null; }                    // 明示♮を外す
    else                    { note.acc = "n"; }                     // 白鍵に明示♮
  }
  return note;
}

var TUPLET_OF = { 48: 32, 24: 16, 12: 8 }, UNTUPLET_OF = { 32: 48, 16: 24, 8: 12 };
var DYNAMICS = ["pp", "p", "mp", "mf", "f", "ff"];

function eventById(score, id) { for (var i = 0; i < score.events.length; i++) if (score.events[i].id === id) return score.events[i]; return null; }

// 消えた事象を指す記号を掃除する。逆順(from が to より後)も削除。同じ組(from+to)の重複も先勝ちで間引く
function pruneReferences(score) {
  var ok = function (ref) {
    var a = eventById(score, ref.from), b = eventById(score, ref.to);
    return a && b && a !== b && a.tick < b.tick;
  };
  var dedupe = function (list) {
    var seenPair = {};
    return list.filter(function (r) {
      var key = r.from + "|" + r.to;
      if (seenPair[key]) return false;
      seenPair[key] = true;
      return true;
    });
  };
  score.slurs = dedupe(score.slurs.filter(function (s) { return ok(s) && eventById(score, s.from).hand === eventById(score, s.to).hand; }));
  score.pedals = dedupe(score.pedals.filter(ok));
  var seen = {};
  score.dynamics = score.dynamics.filter(function (d) { if (!eventById(score, d.eventId) || seen[d.eventId]) return false; seen[d.eventId] = true; return true; });
  var n = deriveMeasures(score).length;
  score.repeats = score.repeats.filter(function (r) { return Number.isInteger(r.startMeasure) && r.startMeasure >= 0 && r.startMeasure < n; })
    .map(function (r) { return { startMeasure: r.startMeasure, endMeasure: (r.endMeasure == null || r.endMeasure < r.startMeasure || r.endMeasure >= n) ? null : r.endMeasure }; });
  return score;
}
// 3連符の組を点検: 3個そろっていない組・その手の並びで隣接していない組は普通の長さに戻す
function fixTuplets(score) {
  var groups = {};
  score.events.forEach(function (e) { if (e.tuplet) (groups[e.tuplet.id] = groups[e.tuplet.id] || []).push(e); });
  var idxByHand = { R: {}, L: {} };
  handEvents(score, "R").forEach(function (e, i) { idxByHand.R[e.id] = i; });
  handEvents(score, "L").forEach(function (e, i) { idxByHand.L[e.id] = i; });
  var revert = function (list) { list.forEach(function (e) { e.dur = UNTUPLET_OF[e.dur] || e.dur; e.tuplet = null; }); };
  Object.keys(groups).forEach(function (id) {
    var g = groups[id];
    if (g.length !== 3) { revert(g); return; }
    var hand = g[0].hand;
    if (!g.every(function (e) { return e.hand === hand; })) { revert(g); return; }
    var idx = idxByHand[hand];
    var positions = g.map(function (e) { return idx[e.id]; }).sort(function (a, b) { return a - b; });
    if (positions[2] - positions[0] !== 2) { revert(g); return; }
  });
  score.events.forEach(function (e) { if (!e.tuplet && UNTUPLET_OF[e.dur]) e.dur = UNTUPLET_OF[e.dur]; });
  return score;
}
// 手の並びの末尾に残った装飾音(後ろに主音がない)は、ふつうの8分音符に戻す
function fixGraces(score) {
  ["R", "L"].forEach(function (hand) {
    var evs = handEvents(score, hand);
    for (var i = 0; i < evs.length; i++) {
      if (!evs[i].grace) continue;
      var hasFollowingNonGrace = false;
      for (var j = i + 1; j < evs.length; j++) { if (!evs[j].grace) { hasFollowingNonGrace = true; break; } }
      if (!hasFollowingNonGrace) evs[i].grace = false;
    }
  });
  return score;
}
// 複製の際、事象のIDを新しく振り直しつつ、スラー・ペダル・強弱・3連符の組の参照を保つ
function reissueEventIds(score) {
  var idMap = {}, tupletMap = {};
  score.events.forEach(function (e) { idMap[e.id] = newId("e"); });
  score.events.forEach(function (e) {
    if (e.tuplet) {
      if (!tupletMap[e.tuplet.id]) tupletMap[e.tuplet.id] = newId("t");
      e.tuplet = { id: tupletMap[e.tuplet.id], num: e.tuplet.num, in: e.tuplet.in };
    }
    e.id = idMap[e.id];
  });
  score.slurs.forEach(function (s) { if (idMap[s.from]) s.from = idMap[s.from]; if (idMap[s.to]) s.to = idMap[s.to]; });
  score.pedals.forEach(function (p) { if (idMap[p.from]) p.from = idMap[p.from]; if (idMap[p.to]) p.to = idMap[p.to]; });
  score.dynamics.forEach(function (d) { if (idMap[d.eventId]) d.eventId = idMap[d.eventId]; });
  return score;
}
function measureIndexOf(score, tick) { return Math.floor(tick / measureTicks(score.timeSig)); }
// 反復を展開した小節の再生順
function playbackMeasureOrder(score) {
  var n = deriveMeasures(score).length, order = [];
  var reps = score.repeats.filter(function (r) { return r.endMeasure != null; }).sort(function (a, b) { return a.startMeasure - b.startMeasure; });
  var i = 0, k = 0;
  while (i < n) {
    while (k < reps.length && reps[k].endMeasure < i) k++;
    if (k < reps.length && reps[k].startMeasure === i) {
      for (var pass = 0; pass < 2; pass++) for (var m = reps[k].startMeasure; m <= reps[k].endMeasure; m++) order.push(m);
      i = reps[k].endMeasure + 1; k++;
    } else { order.push(i); i++; }
  }
  return order;
}

var NON_TUPLET_DURATIONS = DURATIONS.filter(function (d) { return !d.tuplet; }).map(function (d) { return d.ticks; });
// 隙間(tick数)を、DURATIONSにある長さ(3連除く)へ大きい順の貪欲法で分解する
function splitGapToRests(ticks) {
  var out = [], remaining = ticks;
  while (remaining >= 12) {
    var picked = null;
    for (var i = 0; i < NON_TUPLET_DURATIONS.length; i++) {
      if (NON_TUPLET_DURATIONS[i] <= remaining) { picked = NON_TUPLET_DURATIONS[i]; break; }
    }
    if (picked == null) break;
    out.push(picked);
    remaining -= picked;
  }
  return out;
}
// 録音した生PCMの前処理: DC(平均)を除き、一次ハイパス(カットオフ約30Hz@22050)を掛け、
// ピークを0.9へ正規化する(電子ピアノのスピーカー越しの録音などで入力レベルが低い場合の対策)。
// ピークが1e-4未満(ほぼ無音)なら正規化はしない。入力は変更せず、常に新しい Float32Array を返す
function preprocessPcm(f32) {
  var n = f32.length;
  var out = new Float32Array(n);
  if (n === 0) return out;
  var mean = 0;
  for (var i = 0; i < n; i++) mean += f32[i];
  mean /= n;
  var prevX = 0, prevY = 0;
  for (var j = 0; j < n; j++) {
    var x = f32[j] - mean;
    var y = x - prevX + 0.9915 * prevY;
    out[j] = y;
    prevX = x; prevY = y;
  }
  var peak = 0;
  for (var k = 0; k < n; k++) { var a = Math.abs(out[k]); if (a > peak) peak = a; }
  if (peak >= 1e-4) {
    var gain = 0.9 / peak;
    for (var m = 0; m < n; m++) out[m] *= gain;
  }
  return out;
}

// サンプルレート変換。間引き(fromRate > toRate)は箱型フィルタ(区間平均)でエイリアシングを抑え、
// 引き伸ばし・同レート(fromRate <= toRate)は線形補間で行う
function resamplePcm(input, fromRate, toRate) {
  var outLen = Math.max(0, Math.floor(input.length * toRate / fromRate));
  var out = new Float32Array(outLen);
  if (outLen === 0) return out;
  if (fromRate <= toRate) {
    var ratio = fromRate / toRate;
    for (var i = 0; i < outLen; i++) {
      var srcPos = i * ratio;
      var idx = Math.floor(srcPos);
      var frac = srcPos - idx;
      var a = idx < input.length ? input[idx] : 0;
      var b = (idx + 1) < input.length ? input[idx + 1] : a;
      out[i] = a + (b - a) * frac;
    }
  } else {
    var r = fromRate / toRate;
    for (var j = 0; j < outLen; j++) {
      var lo = Math.max(0, Math.round(j * r - r / 2));
      var hi = Math.min(input.length, Math.round(j * r + r / 2));
      if (hi <= lo) hi = Math.min(input.length, lo + 1);
      var sum = 0, count = 0;
      for (var k = lo; k < hi; k++) { sum += input[k]; count++; }
      out[j] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

// 16bit PCM モノラルの WAV(RIFF)にエンコードする。値は[-1,1]にクリップして四捨五入
function encodeWav(f32, sampleRate) {
  var numSamples = f32.length;
  var blockAlign = 2;
  var byteRate = sampleRate * blockAlign;
  var dataSize = numSamples * 2;
  var buffer = new ArrayBuffer(44 + dataSize);
  var view = new DataView(buffer);
  function writeString(offset, str) {
    for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  var offset = 44;
  for (var n = 0; n < numSamples; n++) {
    var s = f32[n];
    if (s > 1) s = 1; else if (s < -1) s = -1;
    view.setInt16(offset, Math.round(s * 32767), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

// Basic Pitch の生の認識結果を掃除する: 範囲外・小さすぎる/短すぎる音を捨て、同音の近接重複をまとめ、再検出を間引き、
// 相対的に小さい音・倍音・単音制約(任意)を取り除く
var HARMONIC_SEMITONES = [12, 19, 24, 28, 31, 36];
var DEFAULT_CLEAN_OPTS = {
  minAmp: 0.12, minDur: 0.06, minMidi: 21, maxMidi: 108, mergeWindow: 0.05,
  relAmp: 0.25, mono: false, monoWindow: 0.08, harmonics: null   // harmonics: null = mono と同じ(単音モードのときだけ倍音除去)
};
function cleanRecognizedNotes(raw, opts) {
  var o = {
    minAmp: (opts && opts.minAmp != null) ? opts.minAmp : DEFAULT_CLEAN_OPTS.minAmp,
    minDur: (opts && opts.minDur != null) ? opts.minDur : DEFAULT_CLEAN_OPTS.minDur,
    minMidi: (opts && opts.minMidi != null) ? opts.minMidi : DEFAULT_CLEAN_OPTS.minMidi,
    maxMidi: (opts && opts.maxMidi != null) ? opts.maxMidi : DEFAULT_CLEAN_OPTS.maxMidi,
    mergeWindow: (opts && opts.mergeWindow != null) ? opts.mergeWindow : DEFAULT_CLEAN_OPTS.mergeWindow,
    relAmp: (opts && opts.relAmp != null) ? opts.relAmp : DEFAULT_CLEAN_OPTS.relAmp,
    mono: (opts && opts.mono != null) ? opts.mono : DEFAULT_CLEAN_OPTS.mono,
    monoWindow: (opts && opts.monoWindow != null) ? opts.monoWindow : DEFAULT_CLEAN_OPTS.monoWindow,
    harmonics: (opts && opts.harmonics != null) ? opts.harmonics : DEFAULT_CLEAN_OPTS.harmonics
  };
  // 倍音除去は既定では単音モードのときだけ。和音を拾うモードではオクターブ重ねなど本物の音を消しかねないため
  if (o.harmonics == null) o.harmonics = !!o.mono;
  // (1) 範囲外・小さすぎる・短すぎるものを捨てる(入力は複製して読み取るだけ、mutateしない)
  // pitchMidi(Basic Pitchの通常出力)/pitch_midi(adjustNoteStart後の出力)のどちらでも受け付ける
  var kept = (raw || []).map(function (n) {
    if (!n) return null;
    var midi = n.pitchMidi != null ? n.pitchMidi : n.pitch_midi;
    return { start: n.startTimeSeconds, dur: n.durationSeconds, midi: midi, amplitude: n.amplitude };
  }).filter(function (n) {
    return n && Number.isFinite(n.start) && Number.isFinite(n.dur) &&
      Number.isFinite(n.midi) && Number.isFinite(n.amplitude) &&
      n.amplitude >= o.minAmp && n.dur >= o.minDur &&
      n.midi >= o.minMidi && n.midi <= o.maxMidi;
  // 以降の同一判定はすべて丸めた音高で行う(59.6と60.4を同じ音として扱う)
  }).map(function (n) { return { start: n.start, dur: n.dur, midi: Math.round(n.midi), amplitude: n.amplitude }; });
  kept.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });

  // (2) 同じ midi で開始が mergeWindow 以内のものは連鎖的に1つにまとめる
  // (代表の開始は連鎖の先頭(最初の開始)のまま、長さ・振幅は連鎖内の最大を採用。
  //  比較は代表の開始ではなく「連鎖内で直前に取り込んだ生ノートの開始」に対して行うことで、
  //  0.00/0.03/0.06 のように少しずつ離れた3個以上の検出も推移的に1つへまとめる)
  var merged = [];
  var lastIndexByMidi = {};
  kept.forEach(function (n) {
    var idx = lastIndexByMidi[n.midi];
    if (idx !== undefined && Math.abs(merged[idx].chainLastStart - n.start) <= o.mergeWindow) {
      var m = merged[idx];
      if (n.dur > m.dur) m.dur = n.dur;
      if (n.amplitude > m.amplitude) m.amplitude = n.amplitude;
      m.chainLastStart = n.start;
      return;
    }
    merged.push({ start: n.start, dur: n.dur, midi: n.midi, amplitude: n.amplitude, chainLastStart: n.start });
    lastIndexByMidi[n.midi] = merged.length - 1;
  });
  merged.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });

  // (3) 同じ音の再検出(前の音がまだ鳴っている間に始まり、前の音の終わり+mergeWindow までに収まる)を捨てる
  var result = [];
  merged.forEach(function (n) {
    var nEnd = n.start + n.dur;
    var isRedetection = result.some(function (k) {
      if (k.midi !== n.midi) return false;
      var kEnd = k.start + k.dur;
      return n.start >= k.start && n.start < kEnd && nEnd <= kEnd + o.mergeWindow;
    });
    if (!isRedetection) result.push(n);
  });

  // (3.5) 録音内の最大振幅 × relAmp 未満の音を捨てる(倍音・雑音の残りかすの誤検出対策)
  if (result.length) {
    var maxAmp = result.reduce(function (mx, n) { return n.amplitude > mx ? n.amplitude : mx; }, 0);
    var relThreshold = maxAmp * o.relAmp;
    result = result.filter(function (n) { return n.amplitude >= relThreshold; });
  }

  // (4) 倍音除去: monoWindow以内に始まる、より低くて大きい音があり、半音差が倍音間隔(1,1.5,2,2.5オクターブ等)で、
  // 自分の振幅がその音の0.7倍未満なら、倍音による誤検出とみなして捨てる
  if (o.harmonics) {
    result = result.filter(function (n) {
      var isHarmonic = result.some(function (k) {
        if (k === n) return false;
        if (k.midi >= n.midi) return false;
        if (k.amplitude <= n.amplitude) return false;
        if (Math.abs(k.start - n.start) > o.monoWindow) return false;
        if (HARMONIC_SEMITONES.indexOf(n.midi - k.midi) === -1) return false;
        return n.amplitude < 0.7 * k.amplitude;
      });
      return !isHarmonic;
    });
  }

  // (5) 単音制約: 開始が monoWindow 以内の音の群ごとに、群内の最大振幅(groupMax)の 0.65倍以上の
  // 音だけを候補にし、その中で一番高い音を残す(同着は振幅が大きい方)。
  // メロディは上の声部にあることが多く、Basic Pitch の振幅は音量に比例しないため、単純な最大振幅採用だと
  // 音量の大きい低音(和音のベースなど)にメロディの音が負けてしまう。さらに各音の長さを
  // 「次に残った音の開始まで」に切りそろえる(重なりを消す)
  if (o.mono) {
    result.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });
    var groups = [];
    result.forEach(function (n) {
      var g = groups[groups.length - 1];
      if (g && (n.start - g[0].start) <= o.monoWindow) g.push(n);
      else groups.push([n]);
    });
    var picked = groups.map(function (g) {
      var groupMax = g.reduce(function (mx, n) { return n.amplitude > mx ? n.amplitude : mx; }, 0);
      var threshold = 0.65 * groupMax;
      var candidates = g.filter(function (n) { return n.amplitude >= threshold; });
      var best = candidates[0];
      candidates.forEach(function (n) {
        if (n.midi > best.midi || (n.midi === best.midi && n.amplitude > best.amplitude)) best = n;
      });
      return best;
    });
    picked.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });
    for (var p = 0; p < picked.length - 1; p++) {
      var gap = picked[p + 1].start - picked[p].start;
      if (gap > 0) picked[p].dur = Math.min(picked[p].dur, gap);
    }
    result = picked;
  }

  // (6) onsetSec 昇順に並べ、{midi, onsetSec, durSec} に整形
  result.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });
  // (1)の kept で既に丸め済みなので、ここでは再度 Math.round しない
  return result.map(function (n) { return { midi: n.midi, onsetSec: n.start, durSec: n.dur }; });
}

// 演奏データ(検出した音符の並び)から譜面を組み立てる。spec §10 の手順どおり
function importPerformance(notes, options) {
  options = options || {};
  var bpm = Number(options.bpm) || 120;
  var splitMidi = options.splitMidi != null ? options.splitMidi : 60;
  var g = Number(options.grid);
  var grid = g === 24 ? 24 : 12;   // 16分(12)/8分(24)の丸め単位("24"のような文字列指定も受け付ける)
  var snapCandidates = NON_TUPLET_DURATIONS.filter(function (v) { return v >= grid; });

  function toTicks(sec) { return Math.round(sec * bpm / 60 * TPQ / grid) * grid; }
  // DURATIONS(3連除く、grid未満は除外)の中で一番近い値へ丸める。同着なら大きい方
  function snapDuration(ticks) {
    var best = snapCandidates[0], bestDiff = Math.abs(ticks - best);
    snapCandidates.forEach(function (v) {
      var diff = Math.abs(ticks - v);
      if (diff < bestDiff || (diff === bestDiff && v > best)) { best = v; bestDiff = diff; }
    });
    return best;
  }
  // 許容値の中で ticks 以下の一番大きい値(重なりの縮小に使う)
  function snapDown(ticks) {
    for (var i = 0; i < NON_TUPLET_DURATIONS.length; i++) if (NON_TUPLET_DURATIONS[i] <= ticks) return NON_TUPLET_DURATIONS[i];
    return NON_TUPLET_DURATIONS[NON_TUPLET_DURATIONS.length - 1];
  }

  var byHand = { R: [], L: [] };
  (notes || []).forEach(function (n) {
    var hand = n.midi < splitMidi ? "L" : "R";
    var tick = toTicks(Math.max(0, n.onsetSec));
    var dur = snapDuration(Math.max(12, toTicks(n.durSec)));
    byHand[hand].push({ tick: tick, dur: dur, midi: n.midi });
  });

  var events = [];
  ["R", "L"].forEach(function (hand) {
    var list = byHand[hand].slice().sort(function (a, b) { return a.tick - b.tick; });
    // 同じ手・同じ丸めた onset の音を1つの和音事象にまとめる
    var groups = [];
    list.forEach(function (n) {
      var last = groups[groups.length - 1];
      if (last && last.tick === n.tick) { last.midis.push(n.midi); last.dur = Math.max(last.dur, n.dur); }
      else groups.push({ tick: n.tick, dur: n.dur, midis: [n.midi] });
    });
    // 重なり(次の始まりが前の終わりより前)は前の事象を縮める
    for (var i = 0; i < groups.length - 1; i++) {
      var cur = groups[i], next = groups[i + 1];
      if (next.tick < cur.tick + cur.dur) cur.dur = snapDown(Math.max(12, next.tick - cur.tick));
    }
    // 隙間(先頭の無音も含む)は休符として埋める
    var cursor = 0;
    groups.forEach(function (g) {
      if (g.tick > cursor) {
        splitGapToRests(g.tick - cursor).forEach(function (restDur) {
          events.push({ id: newId("e"), hand: hand, tick: 0, dur: restDur, notes: [], rest: true, tie: false, grace: false, tuplet: null });
        });
      }
      events.push({
        id: newId("e"), hand: hand, tick: 0, dur: g.dur,
        notes: g.midis.map(function (m) { return { midi: m, acc: null }; }),
        rest: false, tie: false, grace: false, tuplet: null
      });
      cursor = g.tick + g.dur;
    });
  });

  var score = newScore(options.title);
  if (options.bpm != null) score.bpm = options.bpm;
  if (options.timeSig) score.timeSig = options.timeSig;
  score.events = events;
  return normalizeScore(score);
}

function normalizeScore(obj) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.events)) throw new Error("読み込めない曲データです");
  var s = newScore(obj.title);
  s.id = typeof obj.id === "string" ? obj.id : s.id;
  s.title = (typeof obj.title === "string" && obj.title.trim()) ? obj.title.slice(0, 100) : "新しい曲";
  s.composer = typeof obj.composer === "string" ? obj.composer.slice(0, 100) : "";
  s.bpm = Math.min(240, Math.max(30, Math.round(Number(obj.bpm) || 90)));
  if (obj.timeSig && TIME_SIGS.some(function (t) { return t.beats === obj.timeSig.beats && t.unit === obj.timeSig.unit; })) s.timeSig = { beats: obj.timeSig.beats, unit: obj.timeSig.unit };
  s.keySig = keySigInfo(obj.keySig).name;
  if (obj.showDoremi) s.showDoremi = { screen: obj.showDoremi.screen !== false, print: obj.showDoremi.print !== false };
  s.events = obj.events.filter(function (e) { return e && (e.hand === "R" || e.hand === "L") && durationInfo(Number(e.dur)); })
    .map(function (e) {
      var notes = Array.isArray(e.notes) ? e.notes.filter(function (n) { return n && Number.isInteger(n.midi) && n.midi >= 21 && n.midi <= 108; })
        .map(function (n) { return { midi: n.midi, acc: (n.acc === "#" || n.acc === "b" || n.acc === "n") ? n.acc : null }; }) : [];
      return { id: typeof e.id === "string" ? e.id : newId("e"), hand: e.hand, tick: 0, dur: Number(e.dur),
        notes: notes, rest: !!e.rest || notes.length === 0, tie: !!e.tie, grace: !!e.grace,
        tuplet: (e.tuplet && typeof e.tuplet.id === "string") ? { id: e.tuplet.id, num: 3, in: 2 } : null };
    });
  s.slurs = (Array.isArray(obj.slurs) ? obj.slurs : []).filter(function (r) { return r && typeof r.from === "string" && typeof r.to === "string"; });
  s.pedals = (Array.isArray(obj.pedals) ? obj.pedals : []).filter(function (r) { return r && typeof r.from === "string" && typeof r.to === "string"; });
  s.dynamics = (Array.isArray(obj.dynamics) ? obj.dynamics : []).filter(function (d) { return d && DYNAMICS.indexOf(d.text) >= 0; });
  s.repeats = (Array.isArray(obj.repeats) ? obj.repeats : []).filter(function (r) { return r && Number.isInteger(r.startMeasure); })
    .map(function (r) { return { startMeasure: r.startMeasure, endMeasure: Number.isInteger(r.endMeasure) ? r.endMeasure : null }; });
  s.createdAt = obj.createdAt || s.createdAt;
  s.updatedAt = obj.updatedAt || s.updatedAt;
  // 版移行: version 1 のみ。将来 version 2 を作ったらここに if (obj.version < 2) {...} を足す
  s.version = FORMAT_VERSION;
  // fix 系は tick 順に依存するため、先に整列してから点検する(読み込んだ直後は tick が全て0のため)
  relayoutHand(s, "R"); relayoutHand(s, "L");
  fixTuplets(s);
  fixGraces(s);
  relayoutHand(s, "R"); relayoutHand(s, "L");
  pruneReferences(s);
  return s;
}

if (typeof module !== "undefined") module.exports = {
  FORMAT_VERSION: FORMAT_VERSION, TPQ: TPQ, DURATIONS: DURATIONS, KEY_SIGS: KEY_SIGS, TIME_SIGS: TIME_SIGS,
  TUPLET_OF: TUPLET_OF, UNTUPLET_OF: UNTUPLET_OF, DYNAMICS: DYNAMICS,
  newId: newId, newScore: newScore, keySigInfo: keySigInfo, measureTicks: measureTicks, durationInfo: durationInfo,
  handEvents: handEvents, relayoutHand: relayoutHand, deriveMeasures: deriveMeasures,
  spellMidi: spellMidi, doremiOf: doremiOf, applyAccidental: applyAccidental, normalizeScore: normalizeScore,
  eventById: eventById, pruneReferences: pruneReferences, fixTuplets: fixTuplets, fixGraces: fixGraces,
  reissueEventIds: reissueEventIds,
  measureIndexOf: measureIndexOf, playbackMeasureOrder: playbackMeasureOrder,
  importPerformance: importPerformance, cleanRecognizedNotes: cleanRecognizedNotes, DEFAULT_CLEAN_OPTS: DEFAULT_CLEAN_OPTS,
  NON_TUPLET_DURATIONS: NON_TUPLET_DURATIONS, splitGapToRests: splitGapToRests,
  preprocessPcm: preprocessPcm, resamplePcm: resamplePcm, encodeWav: encodeWav
};
