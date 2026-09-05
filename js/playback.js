"use strict";
var Synth = {
  ctx: null,
  ensure: function () {
    if (!this.ctx) { var AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  // ピアノ風: 基音(sine)+第2倍音(triangle弱め)、速い立ち上がり、指数減衰、音の終わりで短いリリース
  play: function (midi, durSec, whenSec) {
    var ctx = this.ensure();
    var t0 = whenSec != null ? whenSec : ctx.currentTime;
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.008);
    gain.gain.setTargetAtTime(0.05, t0 + 0.02, 0.6);
    gain.gain.setTargetAtTime(0.0001, t0 + durSec, 0.03);
    gain.connect(ctx.destination);
    var o1 = ctx.createOscillator(); o1.type = "sine"; o1.frequency.value = freq;
    var o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = freq * 2;
    var g2 = ctx.createGain(); g2.gain.value = 0.25;
    o1.connect(gain); o2.connect(g2); g2.connect(gain);
    o1.start(t0); o2.start(t0);
    o1.stop(t0 + durSec + 0.3); o2.stop(t0 + durSec + 0.3);
    // 途中で止めるための取っ手(Task 6 の Player.stop が使う)
    return { stop: function () { var n = ctx.currentTime; gain.gain.cancelScheduledValues(n); gain.gain.setTargetAtTime(0.0001, n, 0.02); try { o1.stop(n + 0.1); o2.stop(n + 0.1); } catch (e) {} } };
  }
};

// 楽譜 → 鳴らす音の列。hands: "RL" | "R" | "L"。タイでつながった同じ音は1音にまとめる
function expandForPlayback(score, hands) {
  hands = hands || "RL";
  var out = [];
  ["R", "L"].forEach(function (hand) {
    if (hands.indexOf(hand) < 0) return;
    var evs = handEvents(score, hand);
    var carried = {};  // midi -> まだ鳴っている out の要素(タイ継続中)
    evs.forEach(function (ev) {
      var next = {};
      if (!ev.rest) ev.notes.forEach(function (n) {
        if (carried[n.midi]) { carried[n.midi].dur += ev.dur; if (ev.tie) next[n.midi] = carried[n.midi]; return; }
        var item = { tick: ev.tick, dur: ev.dur, midi: n.midi, eventId: ev.id, hand: hand };
        out.push(item);
        if (ev.tie) next[n.midi] = item;
      });
      carried = next;
    });
  });
  out.sort(function (a, b) { return a.tick - b.tick || a.midi - b.midi; });
  return out;
}
var Player = {
  playing: false, timer: null, voices: [],
  start: function (score, opts) {
    this.stop();
    var ctx = Synth.ensure();
    var list = expandForPlayback(score, opts.hands || "RL");
    if (!list.length) return false;
    var spt = 60 / opts.bpm / TPQ, start = ctx.currentTime + 0.15, total = 0, self = this;
    list.forEach(function (it) {
      self.voices.push(Synth.play(it.midi, Math.max(0.08, it.dur * spt * 0.95), start + it.tick * spt));
      total = Math.max(total, it.tick + it.dur);
    });
    this.playing = true;
    this.timer = setInterval(function () {
      var tick = (ctx.currentTime - start) / spt;
      if (tick >= total) { self.stop(); if (opts.onEnd) opts.onEnd(); return; }
      if (opts.onTick) opts.onTick(Math.max(0, Math.floor(tick)));
    }, 50);
    return true;
  },
  stop: function () {
    clearInterval(this.timer); this.timer = null;
    this.voices.forEach(function (v) { if (v && v.stop) v.stop(); }); this.voices = [];
    this.playing = false;
  }
};
if (typeof module !== "undefined") module.exports = { expandForPlayback: expandForPlayback };
