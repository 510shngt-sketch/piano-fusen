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

function normalizeScore(obj) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.events)) throw new Error("読み込めない曲データです");
  var s = newScore(obj.title);
  s.id = typeof obj.id === "string" ? obj.id : s.id;
  s.title = typeof obj.title === "string" ? obj.title : s.title;
  s.composer = typeof obj.composer === "string" ? obj.composer : "";
  s.bpm = Math.min(240, Math.max(30, Math.round(Number(obj.bpm) || 90)));
  if (obj.timeSig && TIME_SIGS.some(function (t) { return t.beats === obj.timeSig.beats && t.unit === obj.timeSig.unit; })) s.timeSig = { beats: obj.timeSig.beats, unit: obj.timeSig.unit };
  s.keySig = keySigInfo(obj.keySig).name;
  if (obj.showDoremi) s.showDoremi = { screen: obj.showDoremi.screen !== false, print: obj.showDoremi.print !== false };
  s.events = obj.events.filter(function (e) { return e && (e.hand === "R" || e.hand === "L") && durationInfo(Number(e.dur)); })
    .map(function (e) {
      var notes = Array.isArray(e.notes) ? e.notes.filter(function (n) { return n && Number.isInteger(n.midi) && n.midi >= 21 && n.midi <= 108; })
        .map(function (n) { return { midi: n.midi, acc: (n.acc === "#" || n.acc === "b" || n.acc === "n") ? n.acc : null }; }) : [];
      return { id: typeof e.id === "string" ? e.id : newId("e"), hand: e.hand, tick: 0, dur: Number(e.dur),
        notes: notes, rest: !!e.rest || notes.length === 0, tie: !!e.tie, grace: !!e.grace, tuplet: e.tuplet || null };
    });
  ["slurs", "dynamics", "pedals", "repeats"].forEach(function (k) { s[k] = Array.isArray(obj[k]) ? obj[k] : []; });
  s.createdAt = obj.createdAt || s.createdAt;
  s.updatedAt = obj.updatedAt || s.updatedAt;
  // 版移行: version 1 のみ。将来 version 2 を作ったらここに if (obj.version < 2) {...} を足す
  s.version = FORMAT_VERSION;
  relayoutHand(s, "R"); relayoutHand(s, "L");
  return s;
}

if (typeof module !== "undefined") module.exports = {
  FORMAT_VERSION: FORMAT_VERSION, TPQ: TPQ, DURATIONS: DURATIONS, KEY_SIGS: KEY_SIGS, TIME_SIGS: TIME_SIGS,
  newId: newId, newScore: newScore, keySigInfo: keySigInfo, measureTicks: measureTicks, durationInfo: durationInfo,
  handEvents: handEvents, relayoutHand: relayoutHand, deriveMeasures: deriveMeasures,
  spellMidi: spellMidi, doremiOf: doremiOf, applyAccidental: applyAccidental, normalizeScore: normalizeScore
};
