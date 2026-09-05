"use strict";
var state = {
  score: null, hand: "R", baseDur: 48, dotted: false, chordMode: false, chordAnchorId: null,
  cursor: { R: 0, L: 0 }, selectedId: null, history: [], future: []
};
var HISTORY_MAX = 100;
var $ = function (id) { return document.getElementById(id); };

function toast(msg, isInfo) {
  var t = $("toast"); t.textContent = msg; t.className = isInfo ? "info" : ""; t.style.display = "block";
  clearTimeout(toast._h); toast._h = setTimeout(function () { t.style.display = "none"; }, 2500);
}
function currentDur() { return state.dotted && state.baseDur !== 192 ? state.baseDur * 1.5 : state.baseDur; }

function render() {
  var s = state.score;
  $("scoreTitle").textContent = s.title;
  var ks = keySigInfo(s.keySig);
  $("infoMeta").textContent = s.timeSig.beats + "/" + s.timeSig.unit + "拍子 ・ " + ks.label + " ・ ♩=" + s.bpm;
  renderScore(s, $("score"), { width: Math.max(320, $("scoreWrap").clientWidth), mode: "edit", showDoremi: s.showDoremi.screen,
    selectedId: state.selectedId, cursor: { hand: state.hand, index: state.cursor[state.hand] }, playheadTick: null });
  renderToolbarState();
}
function renderToolbarState() {
  document.querySelectorAll("#toolNotes [data-dur]").forEach(function (b) { b.classList.toggle("on", Number(b.dataset.dur) === state.baseDur); });
  $("btnDotted").classList.toggle("on", state.dotted);
  $("btnChord").classList.toggle("on", state.chordMode);
  $("btnHandR").classList.toggle("on", state.hand === "R");
  $("btnHandL").classList.toggle("on", state.hand === "L");
}
function saveNow() { if (!saveScore(state.score)) toast("保存できませんでした(端末の保存領域が足りません)"); }

function mutate(fn) {
  if (Player.playing) stop();
  state.history.push(JSON.stringify(state.score));
  if (state.history.length > HISTORY_MAX) state.history.shift();
  state.future = [];
  fn();
  relayoutHand(state.score, "R"); relayoutHand(state.score, "L");
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
  mutate(function () {
    var sel = state.selectedId ? findEvent(state.selectedId) : null;
    if (sel) {  // 選択中: 音を差し替える(和音モードなら重ねる)
      if (state.chordMode) { if (!sel.notes.some(function (n) { return n.midi === midi; })) sel.notes.push({ midi: midi, acc: null }); }
      else sel.notes = [{ midi: midi, acc: null }];
      sel.rest = false; return;
    }
    var anchor = state.chordMode && state.chordAnchorId ? findEvent(state.chordAnchorId) : null;
    if (anchor && anchor.hand === state.hand) { if (!anchor.notes.some(function (n) { return n.midi === midi; })) anchor.notes.push({ midi: midi, acc: null }); return; }
    var ev = makeEvent(state.hand, currentDur(), [{ midi: midi, acc: null }], false);
    insertEventAtCursor(ev);
    if (state.chordMode) state.chordAnchorId = ev.id;
  });
  scrollToCursor();
}
function addRest() {
  mutate(function () {
    var sel = state.selectedId ? findEvent(state.selectedId) : null;
    if (sel) { sel.rest = !sel.rest; if (sel.rest) sel.notes = []; return; }
    insertEventAtCursor(makeEvent(state.hand, currentDur(), [], true));
    state.chordAnchorId = null;
  });
  scrollToCursor();
}
function setDuration(ticks) {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  var info = durationInfo(ticks);
  if (!info) return;
  if (sel) { mutate(function () { sel.dur = ticks; }); return; }
  state.baseDur = ticks; if (ticks === 192) state.dotted = false;
  renderToolbarState();
}
function setDotted(on) {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (sel) {
    var base = durationInfo(sel.dur);
    if (!base) return;
    var b = base.dots ? sel.dur / 1.5 : sel.dur; var nd = on ? (b === 192 ? 192 : b * 1.5) : b; if (durationInfo(nd)) mutate(function () { sel.dur = nd; }); return;
  }
  state.dotted = on && state.baseDur !== 192; renderToolbarState();
}
function setHand(h) { state.hand = h; state.chordAnchorId = null; state.selectedId = null; render(); scrollKeyboardTo(h === "R" ? 60 : 48); }
function setChordMode(on) { state.chordMode = on; state.chordAnchorId = null; renderToolbarState(); }
function setRestMode() { addRest(); }
function scrollToCursor() { var w = $("scoreWrap"); var evs = handEvents(state.score, state.hand); if (state.cursor[state.hand] >= evs.length) w.scrollTop = w.scrollHeight; }

// ---- 音符面のボタン ----
function buildToolbar() {
  var tn = $("toolNotes");
  [[192, "𝅝 全"], [96, "𝅗𝅥 2分"], [48, "♩ 4分"], [24, "♪ 8分"], [12, "𝅘𝅥𝅯 16分"]].forEach(function (d) {
    var b = document.createElement("button"); b.dataset.dur = d[0]; b.textContent = d[1];
    b.onclick = function () { setDuration(d[0]); }; tn.appendChild(b);
  });
  var mk = function (id, text, fn) { var b = document.createElement("button"); b.id = id; b.textContent = text; b.onclick = fn; tn.appendChild(b); return b; };
  mk("btnDotted", "付点", function () { setDotted(!state.dotted); });
  mk("btnRest", "休符", function () { setRestMode(true); });
  mk("btnChord", "和音", function () { setChordMode(!state.chordMode); });
  var sp = document.createElement("span"); sp.className = "spacer"; tn.appendChild(sp);
  mk("btnHandR", "右手", function () { setHand("R"); });
  mk("btnHandL", "左手", function () { setHand("L"); });
  $("btnFaceNotes").onclick = function () { $("toolNotes").hidden = false; $("toolSigns").hidden = true; $("btnFaceNotes").classList.add("on"); $("btnFaceSigns").classList.remove("on"); };
  $("btnFaceSigns").onclick = function () { $("toolNotes").hidden = true; $("toolSigns").hidden = false; $("btnFaceSigns").classList.add("on"); $("btnFaceNotes").classList.remove("on"); };
}

// ---- 鍵盤: C2(36)〜C7(96)。白鍵44px。黒鍵は白鍵の境目に重ねる ----
var KEY_W = 44, KEY_LOW = 36, KEY_HIGH = 96;
var WHITE_PC = [0, 2, 4, 5, 7, 9, 11], BLACK_AFTER = { 0: true, 2: true, 5: true, 7: true, 9: true };
function buildKeyboard() {
  var kb = $("keyboard"); kb.innerHTML = "";
  var inner = document.createElement("div"); inner.style.cssText = "position:relative;height:100%;display:flex;";
  var whites = [];
  for (var m = KEY_LOW; m <= KEY_HIGH; m++) if (WHITE_PC.indexOf(m % 12) >= 0) whites.push(m);
  inner.style.width = whites.length * KEY_W + "px";
  whites.forEach(function (m, i) {
    var k = document.createElement("div"); k.className = "wkey"; k.dataset.midi = m;
    k.style.cssText = "width:" + KEY_W + "px;height:100%;border:1px solid #999;border-radius:0 0 6px 6px;background:#fff;display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;font-size:13px;color:#555;user-select:none;";
    k.textContent = doremiOf(m, "C", null) + (m % 12 === 0 ? (Math.floor(m / 12) - 1) : "");
    inner.appendChild(k);
    if (BLACK_AFTER[m % 12] && m + 1 <= KEY_HIGH) {
      var b = document.createElement("div"); b.className = "bkey"; b.dataset.midi = m + 1;
      b.style.cssText = "position:absolute;top:0;left:" + ((i + 1) * KEY_W - KEY_W * 0.3) + "px;width:" + (KEY_W * 0.6) + "px;height:60%;background:#333;border-radius:0 0 4px 4px;z-index:2;";
      inner.appendChild(b);
    }
  });
  kb.appendChild(inner);
  var down = function (e) {
    var t = e.target.closest("[data-midi]"); if (!t) return;
    t.style.filter = "brightness(0.8)";
    addNote(Number(t.dataset.midi));
    setTimeout(function () { t.style.filter = ""; }, 120);
  };
  kb.addEventListener("pointerdown", down);
}
function scrollKeyboardTo(midi) {
  var kb = $("keyboard"), el = kb.querySelector('[data-midi="' + midi + '"]'); if (!el) return;
  kb.scrollLeft = Math.max(0, el.offsetLeft - KEY_W * 2);
}

// ---- 再生 ----
var playState = { tick: null, lastKey: "", hands: "RL" };
function renderPlayhead(tick) {
  var hands = playState.hands || "RL";
  var ids = state.score.events.filter(function (e) { return !e.rest && hands.indexOf(e.hand) >= 0 && e.tick <= tick && tick < e.tick + e.dur; }).map(function (e) { return e.id; }).join(",");
  if (ids === playState.lastKey) return;      // 光る音符が変わったときだけ描き直す
  playState.lastKey = ids; playState.tick = tick;
  renderScore(state.score, $("score"), { width: Math.max(320, $("scoreWrap").clientWidth), mode: "edit", showDoremi: state.score.showDoremi.screen, selectedId: null, cursor: null, playheadTick: tick, playheadHands: hands });
  var first = ids.split(",")[0], g = first ? document.getElementById("vf-" + first) : null;
  if (g) { var r = g.getBoundingClientRect(), w = $("scoreWrap").getBoundingClientRect(); if (r.top < w.top || r.bottom > w.bottom) g.scrollIntoView({ block: "center" }); }
}
function setPlayBpm(v) { $("playBpm").value = v; $("playBpmVal").textContent = "♩=" + v; }
function play() {
  playState.hands = $("playHands").value;
  var ok = Player.start(state.score, { hands: playState.hands, bpm: Number($("playBpm").value) || state.score.bpm,
    onTick: renderPlayhead, onEnd: stop });
  if (!ok) { toast("鳴らす音符がありません", true); return; }
  $("btnPlay").hidden = true; $("btnStop").hidden = false; playState.lastKey = "";
}
function stop() { Player.stop(); $("btnPlay").hidden = false; $("btnStop").hidden = true; playState.lastKey = ""; render(); }
function bindPlayback() {
  $("btnPlay").onclick = play; $("btnStop").onclick = stop;
  $("playBpm").oninput = function () { setPlayBpm($("playBpm").value); };
}

// ---- 起動 ----
function openScoreObject(s) {
  state.score = s; state.selectedId = null; state.chordAnchorId = null;
  state.cursor = { R: handEvents(s, "R").length, L: handEvents(s, "L").length };
  state.history = []; state.future = [];
  setLastOpen(s.id); render();
  setPlayBpm(s.bpm); if (Player.playing) stop();
}
function boot() {
  buildToolbar(); buildKeyboard();
  buildSignsFace(); bindEditing();
  buildSettingsDialog(); buildListDialog();
  bindPlayback(); bindPrint();
  var lastId = getLastOpen();
  var ids = listScores().map(function (m) { return m.id; });
  if (lastId) { ids = ids.filter(function (id) { return id !== lastId; }); ids.unshift(lastId); }
  var s = null;
  for (var i = 0; i < ids.length && !s; i++) s = loadScore(ids[i]);
  if (!s) { s = newScore(); saveScore(s); }
  openScoreObject(s);
  scrollKeyboardTo(60);
  window.addEventListener("resize", function () { render(); });
}
function loadSample() {
  return fetch("dev/sample-kirakira.json").then(function (r) { return r.json(); }).then(function (j) {
    var s = normalizeScore(j); s.id = newId("s"); saveScore(s); openScoreObject(s); return s;
  });
}
function resetForTest() { Object.keys(localStorage).filter(function (k) { return k.indexOf("pianoFusen.") === 0; }).forEach(function (k) { localStorage.removeItem(k); }); }

function select(id) {
  if (id && !findEvent(id)) return;
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
  mutate(function () { sel.tie = !sel.tie; });
}
function moveCursorToEnd() { state.selectedId = null; state.chordAnchorId = null; state.cursor[state.hand] = handEvents(state.score, state.hand).length; render(); scrollToCursor(); }
function undo() {
  if (!state.history.length) return;
  state.future.push(JSON.stringify(state.score));
  state.score = normalizeScore(JSON.parse(state.history.pop()));
  state.selectedId = null; state.chordAnchorId = null; clampCursor(); saveNow(); render();
}
function redo() {
  if (!state.future.length) return;
  state.history.push(JSON.stringify(state.score));
  state.score = normalizeScore(JSON.parse(state.future.pop()));
  state.selectedId = null; state.chordAnchorId = null; clampCursor(); saveNow(); render();
}
function clampCursor() { ["R", "L"].forEach(function (h) { state.cursor[h] = Math.min(state.cursor[h], handEvents(state.score, h).length); }); }

function buildSignsFace() {
  var ts = $("toolSigns");
  var mk = function (id, text, fn) { var b = document.createElement("button"); b.id = id; b.textContent = text; b.onclick = fn; ts.appendChild(b); return b; };
  mk("btnSharp", "♯", function () { setAccidental("#"); });
  mk("btnFlat", "♭", function () { setAccidental("b"); });
  mk("btnNatural", "♮", function () { setAccidental("n"); });
  mk("btnTie", "タイ", function () { toggleTie(); });
  var sp = document.createElement("span"); sp.className = "spacer"; ts.appendChild(sp);
  mk("btnToEnd", "末尾へ", function () { moveCursorToEnd(); });
}
function bindEditing() {
  $("score").addEventListener("click", function (e) {
    var g = e.target.closest('g[id^="vf-"]');
    select(g ? g.id.slice(3) : null);
  });
  $("btnDelete").onclick = deleteSelected;
  $("btnUndo").onclick = undo; $("btnRedo").onclick = redo;
  document.addEventListener("keydown", function (e) {
    if (document.querySelector("dialog[open]")) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); deleteSelected(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      var evs = handEvents(state.score, state.hand); if (!evs.length) return;
      var i = state.selectedId ? evs.indexOf(findEvent(state.selectedId)) : state.cursor[state.hand];
      i = Math.max(0, Math.min(evs.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)));
      state.selectedId = null; select(evs[i].id);
    }
  });
}

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
function openSettings() {
  var s = state.score;
  $("fTitle").value = s.title; $("fComposer").value = s.composer; $("fBpm").value = s.bpm;
  $("fTimeSig").value = s.timeSig.beats + "/" + s.timeSig.unit; $("fKeySig").value = s.keySig;
  $("fDoremiScreen").checked = s.showDoremi.screen; $("fDoremiPrint").checked = s.showDoremi.print;
  $("dlgSettings").showModal();
}
function buildSettingsDialog() {
  TIME_SIGS.forEach(function (t) { var o = document.createElement("option"); o.value = t.beats + "/" + t.unit; o.textContent = t.beats + "/" + t.unit; $("fTimeSig").appendChild(o); });
  KEY_SIGS.forEach(function (k) { var o = document.createElement("option"); o.value = k.name; o.textContent = k.label + "(" + k.name + ")"; $("fKeySig").appendChild(o); });
  $("btnSettings").onclick = openSettings;
  $("infoMeta").onclick = openSettings;
  $("btnSettingsCancel").onclick = function () { $("dlgSettings").close(); };
  $("dlgSettings").addEventListener("close", function () {
    if ($("dlgSettings").returnValue !== "ok") return;
    var ts = $("fTimeSig").value.split("/");
    updateSettings({ title: $("fTitle").value, composer: $("fComposer").value, bpm: $("fBpm").value,
      timeSig: { beats: Number(ts[0]), unit: Number(ts[1]) }, keySig: $("fKeySig").value,
      showDoremi: { screen: $("fDoremiScreen").checked, print: $("fDoremiPrint").checked } });
    $("dlgSettings").returnValue = "";
  });
}

function newScoreAction() { var s = newScore(); saveScore(s); openScoreObject(s); $("dlgList").close(); }
function openScore(id) { var s = loadScore(id); if (!s) { toast("その曲は開けませんでした"); return; } openScoreObject(s); $("dlgList").close(); }
function duplicateScore(id) {
  var s = loadScore(id); if (!s) { toast("その曲は開けませんでした"); return; }
  s.id = newId("s"); s.title = s.title + " のコピー"; s.createdAt = new Date().toISOString();
  s.events.forEach(function (e) { e.id = newId("e"); });
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
function renderList() {
  var box = $("listItems"); box.innerHTML = "";
  var items = listScores();
  if (!items.length) { box.textContent = "まだ曲がありません。"; return; }
  items.forEach(function (it) {
    var row = document.createElement("div"); row.className = "listItem" + (it.id === state.score.id ? " current" : "");
    var name = document.createElement("div"); name.className = "name"; name.textContent = it.title;
    var date = document.createElement("div"); date.className = "date"; date.textContent = (it.updatedAt || "").slice(0, 10);
    var bOpen = document.createElement("button"); bOpen.textContent = "開く"; bOpen.onclick = function () { openScore(it.id); };
    var bDup = document.createElement("button"); bDup.textContent = "複製"; bDup.onclick = function () { duplicateScore(it.id); };
    var bDel = document.createElement("button"); bDel.textContent = "削除"; bDel.onclick = function () { deleteScore(it.id); };
    row.appendChild(name); row.appendChild(date); row.appendChild(bOpen); row.appendChild(bDup); row.appendChild(bDel);
    box.appendChild(row);
  });
}
function buildListDialog() {
  $("btnList").onclick = function () { renderList(); $("dlgList").showModal(); };
  $("btnListClose").onclick = function () { $("dlgList").close(); };
  $("btnNewScore").onclick = newScoreAction;
}

// ---- 印刷 ----
var PRINT = { widthPx: Math.round(180 / 25.4 * 96), heightPx: Math.round(267 / 25.4 * 96) };
function preparePrint() {
  return renderPrintPages(state.score, $("printArea"), { width: PRINT.widthPx, height: PRINT.heightPx, showDoremi: state.score.showDoremi.print });
}
// 印刷用DOMを描いてから印刷ダイアログを開くため、描画を1フレーム待つ
function printNow() { preparePrint(); setTimeout(function () { window.print(); }, 50); }
function bindPrint() {
  $("btnPrint").onclick = printNow;
  window.addEventListener("beforeprint", function () { preparePrint(); });   // Ctrl+P / 共有→プリント にも対応
}

window.App = {
  get score() { return state.score; }, state: state,
  addNote: addNote, addRest: addRest, setDuration: setDuration, setDotted: setDotted, setHand: setHand,
  setChordMode: setChordMode, setRestMode: setRestMode, render: render, saveNow: saveNow, loadSample: loadSample, resetForTest: resetForTest,
  select: select, deleteSelected: deleteSelected, setAccidental: setAccidental, toggleTie: toggleTie, moveCursorToEnd: moveCursorToEnd, undo: undo, redo: redo,
  updateSettings: updateSettings, newScoreAction: newScoreAction, openScore: openScore, duplicateScore: duplicateScore, deleteScore: deleteScore, listScores: listScores,
  play: play, stop: stop, preparePrint: preparePrint, printNow: printNow
};
document.addEventListener("DOMContentLoaded", boot);
