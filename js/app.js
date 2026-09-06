"use strict";
var $ = function (id) { return document.getElementById(id); };

function toast(msg, isInfo) {
  var t = $("toast"); t.textContent = msg; t.className = isInfo ? "info" : ""; t.style.display = "block";
  clearTimeout(toast._h); toast._h = setTimeout(function () { t.style.display = "none"; }, 2500);
}

function render() {
  var s = state.score;
  $("scoreTitle").textContent = s.title;
  var ks = keySigInfo(s.keySig);
  $("infoMeta").textContent = s.timeSig.beats + "/" + s.timeSig.unit + "拍子 ・ " + ks.label + " ・ ♩=" + s.bpm;
  renderScore(s, $("score"), { width: Math.max(320, $("scoreWrap").clientWidth), mode: "edit", showDoremi: s.showDoremi.screen,
    selectedId: state.viewMode ? null : state.selectedId,
    cursor: state.viewMode ? null : { hand: state.hand, index: state.cursor[state.hand] } });
  renderToolbarState();
}
function renderToolbarState() {
  document.querySelectorAll("#toolNotes [data-dur]").forEach(function (b) { b.classList.toggle("on", Number(b.dataset.dur) === state.baseDur); });
  $("btnDotted").classList.toggle("on", state.dotted);
  $("btnChord").classList.toggle("on", state.chordMode);
  $("btnTuplet").classList.toggle("on", !!state.tupletMode);
  $("btnHand").textContent = state.hand === "R" ? "右手" : "左手";
  $("btnHand").classList.add("on");
  $("btnSlur").classList.toggle("on", !!(state.pending && state.pending.kind === "slur"));
  $("btnPedal").classList.toggle("on", !!(state.pending && state.pending.kind === "pedal"));
  $("btnGrace").classList.toggle("on", state.graceMode);
}
function saveNow() { if (!saveScore(state.score)) toast("保存できませんでした(端末の保存領域が足りません)"); }
function scrollToCursor() { var w = $("scoreWrap"); var evs = handEvents(state.score, state.hand); if (state.cursor[state.hand] >= evs.length) w.scrollTop = w.scrollHeight; }

// ---- 音符アイコン(viewBox 24x32、currentColor で塗る。ボタンの on 状態で色が変わる) ----
function noteIcon(kind) {
  var head = function (cx, cy, filled) {
    return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="5.2" ry="3.6" transform="rotate(-20 ' + cx + ' ' + cy + ')"' + (filled ? '' : ' fill="none" stroke-width="2"') + '/>';
  };
  var stem = function (x, y1, y2) { return '<rect x="' + (x - 0.8) + '" y="' + y1 + '" width="1.6" height="' + (y2 - y1) + '"/>'; };
  var flag = function (x, y) { return '<path d="M' + x + ' ' + y + ' q7 3 6 11 q1-6-6-7z"/>'; };
  var body = "";
  switch (kind) {
    case "w": body = head(12, 20, false); break;
    case "h": body = head(10, 24, false) + stem(14.6, 6, 24); break;
    case "q": body = head(10, 24, true) + stem(14.6, 6, 24); break;
    case "8": body = head(10, 24, true) + stem(14.6, 6, 24) + flag(15.4, 6); break;
    case "16": body = head(10, 24, true) + stem(14.6, 6, 24) + flag(15.4, 6) + flag(15.4, 11); break;
    case "dot": body = head(9, 24, true) + stem(13.6, 6, 24) + '<circle cx="19" cy="24" r="1.6"/>'; break;
    case "rest": body = '<path d="M11 4 h3 l-4 7 h3 l-4 6 h3 l-5 8 c3-1 4 0 3 2 c3-1 4-4 1-5 l4-6 h-3 l4-7z"/>'; break;
    case "chord": body = head(10, 24, true) + head(10, 19, true) + head(10, 14, true) + stem(14.6, 2, 24); break;
    case "tuplet":
      body = '<text x="12" y="11" font-family="serif" font-style="italic" font-weight="bold" font-size="12" fill="currentColor" stroke="none" text-anchor="middle">3</text>'
        + '<rect x="3.6" y="15" width="16.8" height="2"/>'
        + '<rect x="3.9" y="15" width="1.4" height="11"/>'
        + '<rect x="11.3" y="15" width="1.4" height="11"/>'
        + '<rect x="18.7" y="15" width="1.4" height="11"/>'
        + '<ellipse cx="4.6" cy="27" rx="3.1" ry="2.2"/>'
        + '<ellipse cx="12" cy="27" rx="3.1" ry="2.2"/>'
        + '<ellipse cx="19.4" cy="27" rx="3.1" ry="2.2"/>';
      break;
    case "tie":
      body = head(6, 25, true) + head(18, 25, true) + '<path d="M7 19 q5 -7 10 0" fill="none" stroke-width="1.6"/>';
      break;
    case "slur":
      body = '<path d="M4 25 q10 -15 16 0" fill="none" stroke-width="1.8"/>';
      break;
    case "dyn":
      body = '<text x="12" y="24" font-family="serif" font-style="italic" font-weight="bold" font-size="14" fill="currentColor" stroke="none" text-anchor="middle">f</text>';
      break;
    case "grace":
      body = head(9, 24, true) + stem(13.6, 7, 24) + flag(14.4, 7) + '<line x1="10" y1="18" x2="18" y2="8" stroke-width="1.8"/>';
      break;
    case "pedal":
      body = '<text x="12" y="20" font-family="serif" font-style="italic" font-weight="bold" font-size="9" fill="currentColor" stroke="none" text-anchor="middle">Ped.</text>';
      break;
    case "repeat":
      body = '<rect x="4" y="4" width="3" height="24"/>'
        + '<rect x="9" y="4" width="1.2" height="24"/>'
        + '<circle cx="15" cy="12" r="1.8"/>'
        + '<circle cx="15" cy="20" r="1.8"/>';
      break;
  }
  return '<svg viewBox="0 0 24 32" aria-hidden="true">' + body + '</svg>';
}

// ---- 音符面のボタン ----
function buildToolbar() {
  var tn = $("toolNotes");
  [[192, "w", "全音符"], [96, "h", "2分音符"], [48, "q", "4分音符"], [24, "8", "8分音符"], [12, "16", "16分音符"]].forEach(function (d) {
    var b = document.createElement("button"); b.dataset.dur = d[0]; b.innerHTML = noteIcon(d[1]);
    b.setAttribute("aria-label", d[2]); b.title = d[2];
    b.onclick = function () { setDuration(d[0]); }; tn.appendChild(b);
  });
  var mk = function (id, kind, label, fn) {
    var b = document.createElement("button"); b.id = id; b.innerHTML = noteIcon(kind);
    b.setAttribute("aria-label", label); b.title = label; b.onclick = fn; tn.appendChild(b); return b;
  };
  mk("btnDotted", "dot", "付点", function () { setDotted(!state.dotted); });
  mk("btnTuplet", "tuplet", "3連符", function () { setTupletMode(!state.tupletMode); });
  mk("btnRest", "rest", "休符", function () { setRestMode(true); });
  mk("btnChord", "chord", "和音", function () { setChordMode(!state.chordMode); });

  // 1段目: [音符][記号][右手/左手][再生][停止] spacer [挿入][末尾へ][戻す][やり直す][消す]
  var btnHand = document.createElement("button"); btnHand.id = "btnHand";
  btnHand.setAttribute("aria-label", "右手/左手を切り替え"); btnHand.title = "右手/左手を切り替え";
  btnHand.onclick = function () { toggleHand(); };
  $("btnPlay").parentNode.insertBefore(btnHand, $("btnPlay"));

  var btnInsert = document.createElement("button"); btnInsert.id = "btnInsert"; btnInsert.textContent = "⇤";
  btnInsert.setAttribute("aria-label", "ここに挿入(選んだ音符の前)"); btnInsert.title = "ここに挿入(選んだ音符の前)";
  btnInsert.onclick = function () { insertBefore(); };
  $("btnUndo").parentNode.insertBefore(btnInsert, $("btnUndo"));

  var btnToEnd = document.createElement("button"); btnToEnd.id = "btnToEnd"; btnToEnd.textContent = "⇥";
  btnToEnd.setAttribute("aria-label", "末尾へ"); btnToEnd.title = "末尾へ";
  btnToEnd.onclick = function () { moveCursorToEnd(); };
  $("btnUndo").parentNode.insertBefore(btnToEnd, $("btnUndo"));

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

  // 誤入力防止: 押した指がそのまま同じ鍵の上で離れたときだけ addNote する。
  // スクロールで指が動いた場合(8px以上)は取り消し、押下色も戻す。
  var press = null; // {midi, el, x, y, pointerId}
  var clearPress = function () {
    if (press && press.el) press.el.style.filter = "";
    press = null;
  };
  kb.addEventListener("pointerdown", function (e) {
    var t = e.target.closest("[data-midi]"); if (!t) return;
    if (press) return; // 複数指の同時タッチは最初の1つだけ扱う
    press = { midi: Number(t.dataset.midi), el: t, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    t.style.filter = "brightness(0.8)";
  });
  kb.addEventListener("pointermove", function (e) {
    if (!press || e.pointerId !== press.pointerId) return;
    var dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (Math.sqrt(dx * dx + dy * dy) >= 8) clearPress();
  });
  kb.addEventListener("pointerup", function (e) {
    if (!press || e.pointerId !== press.pointerId) return;
    var dx = e.clientX - press.x, dy = e.clientY - press.y;
    var moved = Math.sqrt(dx * dx + dy * dy) >= 8;
    var stillOnKey = false;
    if (!moved) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var t = el && el.closest && el.closest("[data-midi]");
      stillOnKey = !!t && t === press.el;
    }
    var midi = press.midi;
    clearPress();
    if (!moved && stillOnKey) addNote(midi);
  });
  kb.addEventListener("pointercancel", function (e) {
    if (press && e.pointerId === press.pointerId) clearPress();
  });
  kb.addEventListener("pointerleave", function (e) {
    if (press && e.pointerId === press.pointerId) clearPress();
  });
}
function scrollKeyboardTo(midi) {
  var kb = $("keyboard"), el = kb.querySelector('[data-midi="' + midi + '"]'); if (!el) return;
  kb.scrollLeft = Math.max(0, el.offsetLeft - KEY_W * 2);
}

// ---- 上段(曲一覧・設定行)の折りたたみ ----
function toggleBars(hidden) {
  if (hidden === undefined) hidden = !document.body.classList.contains("barsHidden");
  document.body.classList.toggle("barsHidden", hidden);
  var b = $("btnBars"); b.textContent = hidden ? "﹀" : "︿"; b.setAttribute("aria-label", hidden ? "上のメニューを出す" : "上のメニューを隠す"); b.title = b.getAttribute("aria-label");
  render();
  // 折りたたみで譜面の幅が変わり描き直されるため、再生中は次のtickで必ずハイライトを描き直させる
  if (Player.playing) playState.lastKey = "";
}
function applyBarsDefault() {
  var hidden = window.innerHeight <= 520;
  if (hidden !== document.body.classList.contains("barsHidden")) toggleBars(hidden);
}

// ---- 表示モード(譜面台): 全画面表示・タップ選択無効・画面を消さない ----
var wakeLock = null;
function requestWakeLock() {
  if (!state.viewMode || !navigator.wakeLock) return;
  navigator.wakeLock.request("screen").then(function (l) { wakeLock = l; }).catch(function () {});
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
}
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") requestWakeLock();
});
function setViewMode(on) {
  state.viewMode = !!on;
  document.body.classList.toggle("viewMode", state.viewMode);
  if (state.viewMode) requestWakeLock(); else releaseWakeLock();
  render();
  // 表示モードの切り替えで譜面が描き直されるため、再生中は次のtickで必ずハイライトを描き直させる
  if (Player.playing) playState.lastKey = "";
}

// ---- 再生 ----
var playState = { tick: null, lastKey: "", list: [] };
function renderPlayhead(tick) {
  var seen = {}, ids = [];
  playState.list.forEach(function (it) {
    if (it.tick <= tick && tick < it.tick + it.dur && !seen[it.eventId]) { seen[it.eventId] = true; ids.push(it.eventId); }
  });
  ids.sort();
  var key = ids.join(",");
  if (key === playState.lastKey) return;      // 光る音符が変わったときだけ描き直す
  playState.lastKey = key; playState.tick = tick;
  renderScore(state.score, $("score"), { width: Math.max(320, $("scoreWrap").clientWidth), mode: "edit", showDoremi: state.score.showDoremi.screen, selectedId: null, cursor: null, playheadIds: ids });
  var first = ids[0], g = first != null ? document.getElementById("vf-" + first) : null;
  if (g) { var r = g.getBoundingClientRect(), w = $("scoreWrap").getBoundingClientRect(); if (r.top < w.top || r.bottom > w.bottom) g.scrollIntoView({ block: "center" }); }
}
function setPlayBpm(v) { $("playBpm").value = v; $("playBpmVal").textContent = "♩=" + v; }
function play() {
  var hands = $("playHands").value;
  var list = Player.start(state.score, { hands: hands, bpm: Number($("playBpm").value) || state.score.bpm,
    onTick: renderPlayhead, onEnd: stop });
  if (!list) { toast("鳴らす音符がありません", true); return; }
  playState.list = list;
  $("btnPlay").hidden = true; $("btnStop").hidden = false; playState.lastKey = "";
  if ($("btnViewPlay")) $("btnViewPlay").textContent = "■";
}
function stop() {
  Player.stop(); $("btnPlay").hidden = false; $("btnStop").hidden = true; playState.lastKey = ""; playState.list = []; render();
  if ($("btnViewPlay")) $("btnViewPlay").textContent = "▶";
}
function bindPlayback() {
  $("btnPlay").onclick = play; $("btnStop").onclick = stop;
  $("playBpm").oninput = function () { setPlayBpm($("playBpm").value); };
}

// ---- 起動 ----
function boot() {
  // 共有リンクで開かれた場合: 通常の起動(最後に開いた曲を開く)はこの後すぐ続けて行い、
  // 取り込みは非同期(decodeShare待ち)で完了した時点で openScoreObject が改めて呼ばれる
  var shareHash = parseShareHash(location.hash);
  if (shareHash) {
    decodeShare(shareHash).then(function (obj) { importScores([obj]); })
      .catch(function () { toast("共有リンクを読めませんでした"); })
      .finally(function () { history.replaceState(null, "", location.pathname + location.search); });
  }
  buildToolbar(); buildKeyboard();
  buildSignsFace(); bindEditing();
  buildSettingsDialog(); buildListDialog(); buildShareDialog();
  buildDynamicDialog(); buildRepeatDialog(); buildRecordDialog();
  bindPlayback(); bindPrint();
  $("btnView").onclick = function () { setViewMode(true); };
  $("btnViewClose").onclick = function () { setViewMode(false); };
  $("btnViewPlay").onclick = function () { if (Player.playing) stop(); else play(); };
  var lastId = getLastOpen();
  var ids = listScores().map(function (m) { return m.id; });
  if (lastId) { ids = ids.filter(function (id) { return id !== lastId; }); ids.unshift(lastId); }
  var s = null;
  for (var i = 0; i < ids.length && !s; i++) s = loadScore(ids[i]);
  if (!s) { s = newScore(); saveScore(s); }
  openScoreObject(s);
  scrollKeyboardTo(60);
  $("btnBars").onclick = function () { toggleBars(); };
  applyBarsDefault();
  var lastShort = window.innerHeight <= 520;
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      render();
      // 再生中はハイライトが古い幅のまま描かれた譜面に残るので、次のtickで必ず描き直させる
      if (Player.playing) playState.lastKey = "";
      var nowShort = window.innerHeight <= 520;
      if (nowShort !== lastShort) { lastShort = nowShort; applyBarsDefault(); }
    }, 120);
  });
  // 向きの変化は resize が飛ばない環境もあるので、メディアクエリの変化でも初期値を再適用する
  var shortMq = window.matchMedia("(max-height: 520px)");
  if (shortMq && shortMq.addEventListener) shortMq.addEventListener("change", function (e) { lastShort = e.matches; applyBarsDefault(); });
}
function loadSample() {
  return fetch("dev/sample-kirakira.json").then(function (r) { return r.json(); }).then(function (j) {
    var s = normalizeScore(j); s.id = newId("s"); saveScore(s); openScoreObject(s); return s;
  });
}
function resetForTest() {
  Object.keys(localStorage).filter(function (k) { return k.indexOf("pianoFusen.") === 0; }).forEach(function (k) { localStorage.removeItem(k); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
  if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); });
}

function buildSignsFace() {
  var ts = $("toolSigns");
  var mkText = function (id, text, fn) { var b = document.createElement("button"); b.id = id; b.textContent = text; b.onclick = fn; ts.appendChild(b); return b; };
  var mkIcon = function (id, kind, label, fn) {
    var b = document.createElement("button"); b.id = id; b.innerHTML = noteIcon(kind);
    b.setAttribute("aria-label", label); b.title = label; b.onclick = fn; ts.appendChild(b); return b;
  };
  mkText("btnSharp", "♯", function () { setAccidental("#"); });
  mkText("btnFlat", "♭", function () { setAccidental("b"); });
  mkText("btnNatural", "♮", function () { setAccidental("n"); });
  mkIcon("btnTie", "tie", "タイ", function () { toggleTie(); });
  mkIcon("btnSlur", "slur", "スラー", function () { startSlur(); });
  mkIcon("btnDyn", "dyn", "強弱", function () { openDynamicDialog(); });
  mkIcon("btnGrace", "grace", "装飾音", function () { setGraceMode(!state.graceMode); });
  mkIcon("btnPedal", "pedal", "ペダル", function () { startPedal(); });
  mkIcon("btnRepeat", "repeat", "反復", function () { openRepeatDialog(); });
}
function openDynamicDialog() {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel || sel.rest) { toast("先に音符をタップして選んでください", true); return; }
  $("dlgDynamic").showModal();
}
function buildDynamicDialog() {
  document.querySelectorAll("#dlgDynamic [data-dyn]").forEach(function (b) {
    b.onclick = function () { setDynamic(b.dataset.dyn); $("dlgDynamic").close(); };
  });
  $("btnDynClear").onclick = function () { setDynamic(null); $("dlgDynamic").close(); };
  $("btnDynCancel").onclick = function () { $("dlgDynamic").close(); };
}
function openRepeatDialog() {
  var sel = state.selectedId ? findEvent(state.selectedId) : null;
  if (!sel) { toast("先に音符をタップして選んでください", true); return; }
  $("dlgRepeat").showModal();
}
function buildRepeatDialog() {
  $("btnRepStart").onclick = function () { setRepeat("start"); $("dlgRepeat").close(); };
  $("btnRepEnd").onclick = function () { setRepeat("end"); $("dlgRepeat").close(); };
  $("btnRepClear").onclick = function () { clearRepeat(); $("dlgRepeat").close(); };
  $("btnRepCancel").onclick = function () { $("dlgRepeat").close(); };
}
// タップ地点から一番近い音符(28px以内)を拾う。iOSで指が太くて外れた場合の救済
function nearestNoteIdAt(x, y) {
  var best = null, bestDist = Infinity;
  document.querySelectorAll('#score g.vf-stavenote[id^="vf-"]').forEach(function (node) {
    var id = node.id.slice(3);
    if (!findEvent(id)) return;
    var r = node.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var d = Math.hypot(x - cx, y - cy);
    if (d < bestDist) { bestDist = d; best = id; }
  });
  return bestDist <= 28 ? best : null;
}
function bindEditing() {
  var scorePending = null;
  $("score").addEventListener("pointerdown", function (e) {
    scorePending = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  });
  $("score").addEventListener("pointerup", function (e) {
    var p = scorePending; scorePending = null;
    if (!p || p.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 8) return; // スクロール操作とみなす
    if (state.viewMode) return;
    var g = e.target.closest('g[id^="vf-"]');
    select(g ? g.id.slice(3) : nearestNoteIdAt(e.clientX, e.clientY));
  });
  $("btnDelete").onclick = deleteSelected;
  $("btnUndo").onclick = undo; $("btnRedo").onclick = redo;
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.viewMode) { setViewMode(false); return; }
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
  $("btnRecordNew").onclick = startRecordingFlow;
}

// ---- マイクで下書き ----
var recognizerScriptPromise = null;
// js/recognizer.js は使うときになって初めて差し込む(初回だけ・キャッシュする)
function loadRecognizerScript() {
  if (recognizerScriptPromise) return recognizerScriptPromise;
  recognizerScriptPromise = new Promise(function (resolve, reject) {
    if (window.Recognizer) { resolve(); return; }
    var s = document.createElement("script");
    s.src = "js/recognizer.js";
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error("認識部品を読み込めませんでした")); };
    document.head.appendChild(s);
  });
  recognizerScriptPromise.catch(function () { recognizerScriptPromise = null; });
  return recognizerScriptPromise;
}
function setRecordState(st) { $("dlgRecord").dataset.state = st; }
function recordTitleStamp() {
  var d = new Date();
  return pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function recordAbortError() { return Object.assign(new Error("録音を取り消しました"), { name: "AbortError" }); }
// 録音中の後始末(停止ボタン/自動停止のどちらでも安全に一度だけ)。null なら録音中ではない
var activeRecStop = null;
// カウント中の「中止」(録音そのものを取り消す)。null ならカウント中ではない
var activeRecAbort = null;
// 「部品を読み込み中」の間に「中止」が押されたことを覚えておくフラグ。読み込みが終わった時点でこれを見て中断する
var recLoadAbortRequested = false;
function startRecordingFlow() {
  if (Player.playing) stop();
  var s = state.score;
  $("recBpm").value = s.bpm; $("recBpmVal").textContent = "♩=" + $("recBpm").value;   // スライダーの範囲(40-200)に丸まった値を表示
  $("recTimeSig").value = s.timeSig.beats + "/" + s.timeSig.unit;
  setRecordState("setup");
  $("dlgList").close();
  $("dlgRecord").showModal();
  // 部品(約2MB)とモデルの読み込みをここで前もって始めておく。利用者がテンポや拍子を選んでいる間に
  // ダウンロードを進めておくためで、失敗してもここでは無視する(本番の読み込みは runRecordingFlow が
  // loadRecognizerScript/Recognizer.load の同じキャッシュ済み Promise を使って再度待つ)
  loadRecognizerScript().then(function () { return Recognizer.load(); }).catch(function () {});
}
function runRecordingFlow() {
  var bpm = Number($("recBpm").value) || 90;
  var ts = $("recTimeSig").value.split("/");
  var beats = Number(ts[0]), unit = Number(ts[1]);
  var grid = Number($("recGrid").value);
  var splitMidi = Number($("recSplit").value);

  recLoadAbortRequested = false;
  setRecordState("loading");
  $("recLoadingText").textContent = "部品を読み込み中";
  loadRecognizerScript().then(function () {
    if (recLoadAbortRequested) throw recordAbortError();
    return Recognizer.load(function (t) { $("recLoadingText").textContent = t; });
  }).then(function () {
    if (recLoadAbortRequested) throw recordAbortError();
    return new Promise(function (resolve) {
      var settled = false;
      var rec = Recognizer.record({
        bpm: bpm, beats: beats, unit: unit, maxSec: 60,
        onCount: function (n) { setRecordState("count"); $("recCount").textContent = n; },
        onRecording: function (sec, rms) {
          setRecordState("recording");
          $("recElapsed").textContent = sec.toFixed(1) + " 秒";
          $("recLevel").style.width = Math.min(100, rms * 300) + "%";
        },
        onAutoStop: function () { doStop(); }
      });
      function doStop() {
        if (settled) return;
        settled = true;
        activeRecStop = null; activeRecAbort = null;
        setRecordState("analyzing");
        $("recProgress").textContent = "解析中";
        resolve(rec.stop());
      }
      activeRecStop = doStop;
      activeRecAbort = rec.stop;   // カウント中の「中止」は完了扱いにせず、そのまま録音を取り消す
      rec.ready.catch(function (e) {
        if (settled) return;
        settled = true;
        activeRecStop = null; activeRecAbort = null;
        if (e && e.name === "AbortError") { toast("取り消しました", true); } else { toast(e.message); }
        setRecordState("setup");
        resolve(null);
      });
    });
  }).then(function (pcm) {
    if (pcm == null) return null; // ready の失敗で既に setup に戻し済み
    if (pcm.length < 22050 * 0.5) { toast("録音が短すぎます"); setRecordState("setup"); return null; }
    return Recognizer.analyze(pcm, function (p) {
      $("recProgress").textContent = typeof p === "number" ? "解析中 " + Math.round(p) + "%" : p;
    }).then(function (notes) {
      if (!notes.length) { toast("音を拾えませんでした。マイクに近づけてもう一度試してください"); setRecordState("setup"); return; }
      var newS = importPerformance(notes, { bpm: bpm, timeSig: { beats: beats, unit: unit }, grid: grid, splitMidi: splitMidi,
        title: "下書き " + recordTitleStamp() });
      if (!saveScore(newS)) { toast("保存できませんでした(端末の保存領域が足りません)"); }
      openScoreObject(newS);
      $("dlgRecord").close();
      toast("下書きができました。間違いは鍵盤で直せます", true);
    });
  }).catch(function (e) {
    if (e && e.name === "AbortError") { toast("取り消しました", true); } else { toast((e && e.message) || "解析に失敗しました"); }
    setRecordState("setup");
  }).finally(function () { activeRecStop = null; activeRecAbort = null; });
}
function buildRecordDialog() {
  TIME_SIGS.forEach(function (t) {
    var o = document.createElement("option"); o.value = t.beats + "/" + t.unit; o.textContent = t.beats + "/" + t.unit;
    $("recTimeSig").appendChild(o);
  });
  $("recBpm").oninput = function () { $("recBpmVal").textContent = "♩=" + $("recBpm").value; };
  $("btnRecClose").onclick = function () { $("dlgRecord").close(); };
  $("btnRecStart").onclick = runRecordingFlow;
  $("btnRecStop").onclick = function () { if (activeRecStop) activeRecStop(); };
  // 「部品を読み込み中」の中止: フラグを立てて画面だけ先に戻す(読み込みが終わった時点でも記録がやり直されない)
  $("btnRecAbortLoad").onclick = function () { recLoadAbortRequested = true; setRecordState("setup"); };
  // カウント中の中止: 録音そのものを取り消す(ready が AbortError で reject され、上の catch が setup に戻す)
  $("btnRecAbortCount").onclick = function () { if (activeRecAbort) activeRecAbort(); };
  // Esc: setup 中はそのまま閉じる。loading/count 中は対応する中止動作を行い、閉じずに setup へ戻す。
  // recording/analyzing 中は何もしない(閉じない)
  $("dlgRecord").addEventListener("cancel", function (e) {
    var st = $("dlgRecord").dataset.state;
    if (st === "setup") return;
    e.preventDefault();
    if (st === "loading") { recLoadAbortRequested = true; setRecordState("setup"); }
    else if (st === "count") { if (activeRecAbort) activeRecAbort(); }
  });
}

// ---- 共有・書き出し/読み込み ----
function safeName(title) { return String(title || "").replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+|\.+$/g, ""); }
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function todayYyyymmdd() { var d = new Date(); return "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
function downloadText(name, text) {
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function showShareUrlBox(url) {
  var box = $("shareUrlBox");
  box.value = url; box.hidden = false;
  toast("長押しして全部コピーしてください", true);
}
function shareLink() {
  return shareUrl(location.origin + location.pathname, state.score).then(function (url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // コピーできたときはこの場で用が済むのでダイアログを閉じる。失敗時はテキスト欄で手動コピーしてもらうので開いたままにする
      return navigator.clipboard.writeText(url).then(function () { $("dlgShare").close(); toast("リンクをコピーしました", true); return url; })
        .catch(function () { showShareUrlBox(url); return url; });
    }
    showShareUrlBox(url);
    return url;
  }).catch(function (e) { toast((e && e.message) || "リンクを作れませんでした"); });
}
function exportJson() {
  var s = state.score;
  downloadText((safeName(s.title).trim() || "曲") + ".piano-fusen.json", JSON.stringify(s, null, 2));
}
function exportBackup() {
  var scores = listScores().map(function (m) { return loadScore(m.id); }).filter(Boolean);
  downloadText("ピアノ譜せん_バックアップ_" + todayYyyymmdd() + ".json", JSON.stringify(makeBackup(scores), null, 2));
}
function importFromText(text) {
  try { var r = parseImport(text); importScores(r.scores); }
  catch (e) { toast(e.message); }
}
function buildShareDialog() {
  $("btnShare").onclick = function () {
    $("shareUrlBox").hidden = true; $("shareUrlBox").value = "";
    $("btnShareSend").hidden = !navigator.share;
    $("dlgShare").showModal();
  };
  $("btnShareClose").onclick = function () { $("dlgShare").close(); };
  $("btnShareCopy").onclick = shareLink;
  $("btnShareSend").onclick = function () {
    // 先にURLを作ってから navigator.share を呼ぶ。共有シート側の失敗(キャンセル含む)は英語のメッセージが来ることがあるので、
    // それはトーストに出さず、キャンセル(AbortError)なら何もせず、それ以外はURLのテキスト欄にフォールバックする
    shareUrl(location.origin + location.pathname, state.score).then(function (url) {
      return navigator.share({ title: state.score.title, url: url }).catch(function (e) {
        if (e && e.name === "AbortError") return;
        showShareUrlBox(url);
      });
    }).catch(function (e) { toast((e && e.message) || "送れませんでした"); });
  };
  $("btnShareExportJson").onclick = exportJson;
  $("btnShareExportBackup").onclick = exportBackup;
  $("btnShareImport").onclick = function () { $("fileImport").click(); };
  $("fileImport").onchange = function (e) {
    var file = e.target.files && e.target.files[0];
    var input = e.target;
    if (!file) return;
    $("dlgShare").close();  // 取り込んだ曲が共有ダイアログの下に隠れたままにならないよう、先に閉じる
    file.text().then(function (text) { importFromText(text); }).finally(function () { input.value = ""; });
  };
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
  select: select, deleteSelected: deleteSelected, setAccidental: setAccidental, toggleTie: toggleTie, moveCursorToEnd: moveCursorToEnd, insertBefore: insertBefore, undo: undo, redo: redo,
  updateSettings: updateSettings, newScoreAction: newScoreAction, openScore: openScore, duplicateScore: duplicateScore, deleteScore: deleteScore, listScores: listScores,
  play: play, stop: stop, preparePrint: preparePrint, printNow: printNow,
  setTupletMode: setTupletMode, setGraceMode: setGraceMode, startSlur: startSlur, startPedal: startPedal,
  setDynamic: setDynamic, setRepeat: setRepeat, clearRepeat: clearRepeat, toggleHand: toggleHand, toggleBars: toggleBars, setViewMode: setViewMode,
  shareLink: shareLink, importFromText: importFromText, exportJson: exportJson, exportBackup: exportBackup, importScores: importScores,
  startRecordingFlow: startRecordingFlow
};
document.addEventListener("DOMContentLoaded", boot);
