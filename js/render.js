"use strict";
var VF = Vex.Flow;
var LAYOUT = { marginX: 10, top: 30, staffGap: 90, rowHeight: 210, minMeasureWidth: 130, firstExtra: 80, maxPerRow: 6 };
var COLOR = { select: "#1d6fd6", playhead: "#e07b00", warn: "#fff3b0", warnText: "#8a6d00", cursor: "#1d6fd6", empty: "#9a9a9a" };

// 幅から「1段に何小節・各小節の幅」を決める。最初の小節は音部記号・調号ぶん広い
function layoutSystems(measures, width) {
  var usable = width - LAYOUT.marginX * 2;
  var perRow = Math.max(1, Math.min(LAYOUT.maxPerRow, Math.floor((usable - LAYOUT.firstExtra) / LAYOUT.minMeasureWidth)));
  var base = (usable - LAYOUT.firstExtra) / perRow;
  var rows = [];
  for (var i = 0; i < measures.length; i += perRow) {
    var chunk = measures.slice(i, i + perRow);
    rows.push({ measures: chunk, widths: chunk.map(function (m, k) { return k === 0 ? base + LAYOUT.firstExtra : base; }) });
  }
  return rows;
}

// 不正な長さ(durationInfo が引けない)の事象は安全に無視する
function emptyRestNote(hand) {
  var n = new VF.StaveNote({ clef: hand === "R" ? "treble" : "bass", keys: [hand === "R" ? "b/4" : "d/3"], duration: "wr" });
  n.setStyle({ fillStyle: COLOR.empty, strokeStyle: COLOR.empty });
  return n;
}

function buildNote(ev, score, opts, graceEvents) {
  var clef = ev.hand === "R" ? "treble" : "bass";
  var info = durationInfo(ev.dur);
  if (!info) return null;
  var note;
  if (ev.rest || ev.notes.length === 0) {
    note = new VF.StaveNote({ clef: clef, keys: [clef === "treble" ? "b/4" : "d/3"], duration: info.vf + "r" });
  } else {
    var sorted = ev.notes.slice().sort(function (a, b) { return a.midi - b.midi; });
    var keys = sorted.map(function (n) { return spellMidi(n.midi, score.keySig, n.acc).vfKey; });
    note = new VF.StaveNote({ clef: clef, keys: keys, duration: info.vf, auto_stem: true });
    if (opts.showDoremi) {
      var label = sorted.map(function (n) { return spellMidi(n.midi, score.keySig, n.acc).doremi; }).join("");
      note.addModifier(new VF.Annotation(label).setFont("sans-serif", 10).setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM), 0);
    }
  }
  if (info.dots) VF.Dot.buildAndAttach([note], { all: true });
  if (graceEvents && graceEvents.length) {
    var gns = graceEvents.map(function (g) {
      var gkeys = g.notes.slice().sort(function (a, b) { return a.midi - b.midi; }).map(function (n) { return spellMidi(n.midi, score.keySig, n.acc).vfKey; });
      var gn = new VF.GraceNote({ clef: clef, keys: gkeys, duration: "8", slash: true });
      gn.setAttribute("id", g.id);
      if (opts.selectedId === g.id) gn.setStyle({ fillStyle: COLOR.select, strokeStyle: COLOR.select });
      return gn;
    });
    var group = new VF.GraceNoteGroup(gns, true);
    if (gns.length >= 2) group.beamNotes();
    note.addModifier(group, 0);
    note._graceNotes = gns;    // 呼び出し側が noteById へ個々の GraceNote を登録するため
  }
  var dyn = score.dynamics.filter(function (d) { return d.eventId === ev.id; })[0];
  if (dyn) note.addModifier(new VF.Annotation(dyn.text).setFont("serif", 13, "bold", "italic").setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM), 0);
  note.setAttribute("id", ev.id);
  if (opts.selectedId === ev.id) note.setStyle({ fillStyle: COLOR.select, strokeStyle: COLOR.select });
  else if (opts.playheadIds && opts.playheadIds.indexOf(ev.id) >= 0) note.setStyle({ fillStyle: COLOR.playhead, strokeStyle: COLOR.playhead });
  return note;
}

function beamGroups(timeSig) {
  if (timeSig.unit === 8) return [new VF.Fraction(3, 8)];
  return [new VF.Fraction(1, 4)];
}

// 拍が合っていない小節: 五線にぴったり重ねて黄色く塗り、理由を添える(編集時のみ)
function drawWarn(ctx, stave, x, w) {
  var top = stave.getYForLine(0) - 12, bottom = stave.getYForLine(4) + 12;
  ctx.save();
  ctx.setFillStyle(COLOR.warn); ctx.fillRect(x, top, w, bottom - top);
  // 文字は音部記号・拍子記号にかぶらないよう、音符の開始位置から
  var lx = Math.max(x + 4, stave.getNoteStartX() - 6);
  ctx.setFillStyle(COLOR.warnText); ctx.setFont("sans-serif", 9); ctx.fillText("拍が合いません", lx, top + 9);
  ctx.restore();
}

// rows を container 内の1つのSVGに描く。戻り値は高さ
function drawRows(score, rows, container, opts) {
  var renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  var height = LAYOUT.top + rows.length * LAYOUT.rowHeight;
  renderer.resize(opts.width, height);
  var ctx = renderer.getContext();
  var noteById = {}, staveOf = {}, rowOf = {};
  var ts = score.timeSig;
  var lastMeasureIndex = opts.lastMeasureIndex;
  var bassStaveOfRow = {};

  rows.forEach(function (row, r) {
    var x = LAYOUT.marginX, y = LAYOUT.top + r * LAYOUT.rowHeight;
    row.measures.forEach(function (mea, k) {
      var w = row.widths[k];
      var st = new VF.Stave(x, y, w), sb = new VF.Stave(x, y + LAYOUT.staffGap, w);
      if (k === 0) {
        st.addClef("treble").addKeySignature(score.keySig);
        sb.addClef("bass").addKeySignature(score.keySig);
        if (mea.index === 0) { st.addTimeSignature(ts.beats + "/" + ts.unit); sb.addTimeSignature(ts.beats + "/" + ts.unit); }
      }
      if (mea.index === lastMeasureIndex && opts.mode === "print") { st.setEndBarType(VF.Barline.type.END); sb.setEndBarType(VF.Barline.type.END); }
      score.repeats.forEach(function (rp) {
        if (rp.startMeasure === mea.index) { st.setBegBarType(VF.Barline.type.REPEAT_BEGIN); sb.setBegBarType(VF.Barline.type.REPEAT_BEGIN); }
        if (rp.endMeasure === mea.index) { st.setEndBarType(VF.Barline.type.REPEAT_END); sb.setEndBarType(VF.Barline.type.REPEAT_END); }
      });
      if (opts.mode === "edit") {
        if (mea.warn.R) drawWarn(ctx, st, x, w);
        if (mea.warn.L) drawWarn(ctx, sb, x, w);
      }
      st.setContext(ctx).draw(); sb.setContext(ctx).draw();
      bassStaveOfRow[r] = sb;
      if (k === 0) {
        new VF.StaveConnector(st, sb).setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
        new VF.StaveConnector(st, sb).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
      }
      var voices = {}, notesOf = {}, tuplets = [];
      ["R", "L"].forEach(function (hand) {
        var evs = mea[hand];
        var notes = [], evOf = [];
        if (evs.length === 0) {
          notes = [emptyRestNote(hand)];
        } else {
          var pendingGrace = [];
          evs.forEach(function (ev) {
            if (ev.grace) { pendingGrace.push(ev); return; }
            var n = buildNote(ev, score, opts, pendingGrace);
            if (n) {
              noteById[ev.id] = n; staveOf[ev.id] = hand === "R" ? st : sb; rowOf[ev.id] = r;
              pendingGrace.forEach(function (g, i) {
                var gn = n._graceNotes && n._graceNotes[i];
                if (gn) { noteById[g.id] = gn; staveOf[g.id] = hand === "R" ? st : sb; rowOf[g.id] = r; }
              });
              notes.push(n); evOf.push(ev);
            }
            pendingGrace = [];
          });
          // 手の末尾に grace が残った場合: 普通の音符として描く
          pendingGrace.forEach(function (g) {
            var n = buildNote(g, score, opts, []);
            if (n) { noteById[g.id] = n; staveOf[g.id] = hand === "R" ? st : sb; rowOf[g.id] = r; notes.push(n); evOf.push(g); }
          });
          if (notes.length === 0) notes = [emptyRestNote(hand)];
        }
        // 3連符: 連続して同じ tuplet.id を持つ3つを VF.Tuplet にまとめる(format 前)
        var i = 0;
        while (i < evOf.length) {
          var tid = evOf[i].tuplet && evOf[i].tuplet.id;
          if (!tid) { i++; continue; }
          var j = i;
          while (j < evOf.length && evOf[j].tuplet && evOf[j].tuplet.id === tid) j++;
          if (j - i === 3) tuplets.push(new VF.Tuplet(notes.slice(i, j), { num_notes: 3, notes_occupied: 2 }));
          i = j;
        }
        var v = new VF.Voice({ num_beats: ts.beats, beat_value: ts.unit }).setMode(VF.Voice.Mode.SOFT).addTickables(notes);
        voices[hand] = v; notesOf[hand] = notes;
      });
      VF.Accidental.applyAccidentals([voices.R], score.keySig);
      VF.Accidental.applyAccidentals([voices.L], score.keySig);
      new VF.Formatter().joinVoices([voices.R]).joinVoices([voices.L]).formatToStave([voices.R, voices.L], st);
      var beamsR = VF.Beam.generateBeams(notesOf.R, { groups: beamGroups(ts) });
      var beamsL = VF.Beam.generateBeams(notesOf.L, { groups: beamGroups(ts) });
      voices.R.draw(ctx, st); voices.L.draw(ctx, sb);
      beamsR.concat(beamsL).forEach(function (b) { b.setContext(ctx).draw(); });
      tuplets.forEach(function (t) { t.setContext(ctx).draw(); });
      x += w;
    });
  });

  // タイ: tie:true の事象と、同じ手の次の事象で同じ音を結ぶ
  ["R", "L"].forEach(function (hand) {
    var evs = handEvents(score, hand);
    for (var i = 0; i < evs.length - 1; i++) {
      var a = evs[i], b = evs[i + 1];
      if (!a.tie || a.rest || b.rest) continue;
      var na = noteById[a.id], nb = noteById[b.id];
      if (!na && !nb) continue;
      var aKeys = a.notes.slice().sort(function (p, q) { return p.midi - q.midi; }).map(function (n) { return n.midi; });
      var bKeys = b.notes.slice().sort(function (p, q) { return p.midi - q.midi; }).map(function (n) { return n.midi; });
      var fi = [], li = [];
      aKeys.forEach(function (m, idx) { var j = bKeys.indexOf(m); if (j >= 0) { fi.push(idx); li.push(j); } });
      if (!fi.length) continue;
      if (na && nb) {
        if (rowOf[a.id] === rowOf[b.id]) {
          new VF.StaveTie({ first_note: na, last_note: nb, first_indices: fi, last_indices: li }).setContext(ctx).draw();
        } else {
          new VF.StaveTie({ first_note: na, last_note: null, first_indices: fi, last_indices: fi }).setContext(ctx).draw();
          new VF.StaveTie({ first_note: null, last_note: nb, first_indices: li, last_indices: li }).setContext(ctx).draw();
        }
      } else if (na) {
        // 相方は別ページ(未描画): このページ側だけ部分タイを描く
        new VF.StaveTie({ first_note: na, last_note: null, first_indices: fi, last_indices: fi }).setContext(ctx).draw();
      } else {
        // 相方は別ページ(未描画): このページ側だけ部分タイを描く
        new VF.StaveTie({ first_note: null, last_note: nb, first_indices: li, last_indices: li }).setContext(ctx).draw();
      }
    }
  });

  // スラー: 段をまたぐ場合は片側だけを段の端まで描く(VexFlow 4.2.3 の Curve は from/to の片方が null でも
  // もう片方の譜表の端まで描画してくれるので、そのまま利用する)
  score.slurs.forEach(function (s) {
    var a = noteById[s.from], b = noteById[s.to];
    if (!a && !b) return;
    var opt = { cps: [{ x: 0, y: 10 }, { x: 0, y: 10 }] };
    if (a && b && rowOf[s.from] === rowOf[s.to]) {
      new VF.Curve(a, b, opt).setContext(ctx).draw();
    } else {
      if (a) new VF.Curve(a, null, opt).setContext(ctx).draw();
      if (b) new VF.Curve(null, b, opt).setContext(ctx).draw();
    }
  });

  // ペダル: ヘ音記号の譜表の下に「Ped.」―――「✱」。段をまたぐときは段末まで線、次の段は段頭から
  var rowLeft = LAYOUT.marginX + 8, rowRight = opts.width - LAYOUT.marginX;
  score.pedals.forEach(function (p) {
    var a = noteById[p.from], b = noteById[p.to];
    if (!a && !b) return;
    var segs = [];
    if (a && b && rowOf[p.from] === rowOf[p.to]) {
      segs.push({ row: rowOf[p.from], x1: a.getAbsoluteX(), x2: b.getAbsoluteX() + 10, s: true, e: true });
    } else {
      if (a) segs.push({ row: rowOf[p.from], x1: a.getAbsoluteX(), x2: rowRight, s: true, e: false });
      if (b) segs.push({ row: rowOf[p.to], x1: rowLeft, x2: b.getAbsoluteX() + 10, s: false, e: true });
    }
    segs.forEach(function (g) {
      if (!bassStaveOfRow[g.row]) return;
      var y = bassStaveOfRow[g.row].getYForLine(4) + (opts.showDoremi ? 34 : 22);   // ヘ音記号の譜表の最下線の下(ドレミ表示中はラベルとぶつからないよう下げる)
      ctx.save(); ctx.setStrokeStyle("#222"); ctx.setLineWidth(1.2); ctx.setFillStyle("#222"); ctx.setFont("serif", 11, "bold", "italic");
      var x1 = g.x1;
      if (g.s) { ctx.fillText("Ped.", g.x1, y + 4); x1 = g.x1 + 26; }
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(g.x2, y); ctx.stroke();
      if (g.e) ctx.fillText("✱", g.x2 + 1, y + 4);
      ctx.restore();
    });
  });

  // カーソル(編集時のみ): 挿入位置に青い縦線
  if (opts.mode === "edit" && opts.cursor) {
    var hand = opts.cursor.hand, evs2 = handEvents(score, hand), idx = Math.min(opts.cursor.index, evs2.length);
    var cx = null, stave = null;
    if (idx < evs2.length && noteById[evs2[idx].id]) { cx = noteById[evs2[idx].id].getAbsoluteX() - 14; stave = staveOf[evs2[idx].id]; }
    else if (evs2.length && noteById[evs2[evs2.length - 1].id]) { var ln = noteById[evs2[evs2.length - 1].id]; cx = ln.getAbsoluteX() + 26; stave = staveOf[evs2[evs2.length - 1].id]; }
    else {
      // その手が空: 1小節目の音符開始位置
      var firstRowY = LAYOUT.top + (hand === "R" ? 0 : LAYOUT.staffGap);
      var tmp = new VF.Stave(LAYOUT.marginX, firstRowY, 100).addClef(hand === "R" ? "treble" : "bass").addKeySignature(score.keySig).addTimeSignature(ts.beats + "/" + ts.unit);
      cx = tmp.getNoteStartX() + 6; stave = tmp;
    }
    if (cx != null) {
      var cy = stave.getYForLine(0) - 12, ch = stave.getYForLine(4) - stave.getYForLine(0) + 24;
      ctx.save(); ctx.setFillStyle(COLOR.cursor); ctx.fillRect(cx, cy, 2, ch); ctx.restore();
    }
  }
  return height;
}

function renderScore(score, container, opts) {
  container.innerHTML = "";
  var measures = deriveMeasures(score);
  var rows = layoutSystems(measures, opts.width);
  var lastMeasureIndex = measures.length ? measures[measures.length - 1].index : -1;
  var height = drawRows(score, rows, container, { width: opts.width, mode: opts.mode, showDoremi: opts.showDoremi, selectedId: opts.selectedId, cursor: opts.cursor, playheadIds: opts.playheadIds, lastMeasureIndex: lastMeasureIndex });
  return { rows: rows, height: height };
}

function renderPrintPages(score, container, opts) {
  container.innerHTML = "";
  var measures = deriveMeasures(score);
  var rows = layoutSystems(measures, opts.width);
  var lastMeasureIndex = measures.length ? measures[measures.length - 1].index : -1;
  var headH = 90;
  var perPageFirst = Math.max(1, Math.floor((opts.height - headH - LAYOUT.top) / LAYOUT.rowHeight));
  var perPage = Math.max(1, Math.floor((opts.height - LAYOUT.top) / LAYOUT.rowHeight));
  var pages = [], i = 0;
  pages.push(rows.slice(0, perPageFirst)); i = perPageFirst;
  while (i < rows.length) { pages.push(rows.slice(i, i + perPage)); i += perPage; }
  pages.forEach(function (pageRows, p) {
    var page = document.createElement("div"); page.className = "print-page";
    if (p === 0) {
      var head = document.createElement("div"); head.className = "print-head";
      head.innerHTML = "<h1></h1><div class='sub'></div><div class='tempo'></div>";
      head.querySelector("h1").textContent = score.title;
      head.querySelector(".sub").textContent = score.composer || "";
      head.querySelector(".tempo").textContent = "♩ = " + score.bpm;
      page.appendChild(head);
    }
    var holder = document.createElement("div"); page.appendChild(holder);
    container.appendChild(page);
    drawRows(score, pageRows, holder, { width: opts.width, mode: "print", showDoremi: opts.showDoremi, selectedId: null, cursor: null, playheadIds: null, lastMeasureIndex: lastMeasureIndex });
  });
  return pages.length;
}
