"use strict";
var STORE_INDEX = "pianoFusen.index", STORE_PREFIX = "pianoFusen.score.";
function readIndex() {
  try { var j = JSON.parse(localStorage.getItem(STORE_INDEX)); if (j && Array.isArray(j.scores)) return j; } catch (e) {}
  return { version: 1, scores: [], lastOpenId: null };
}
function writeIndex(ix) { localStorage.setItem(STORE_INDEX, JSON.stringify(ix)); }
function listScores() {
  return readIndex().scores.slice().sort(function (a, b) { return (b.updatedAt || "").localeCompare(a.updatedAt || ""); });
}
function saveScore(score) {
  try {
    score.updatedAt = new Date().toISOString();
    localStorage.setItem(STORE_PREFIX + score.id, JSON.stringify(score));
    var ix = readIndex();
    var hit = ix.scores.filter(function (s) { return s.id === score.id; })[0];
    if (hit) { hit.title = score.title; hit.updatedAt = score.updatedAt; }
    else ix.scores.push({ id: score.id, title: score.title, updatedAt: score.updatedAt });
    writeIndex(ix);
    return true;
  } catch (e) { return false; }
}
function loadScore(id) {
  try { var j = JSON.parse(localStorage.getItem(STORE_PREFIX + id)); return j ? normalizeScore(j) : null; } catch (e) { return null; }
}
function deleteScoreData(id) {
  localStorage.removeItem(STORE_PREFIX + id);
  var ix = readIndex(); ix.scores = ix.scores.filter(function (s) { return s.id !== id; });
  if (ix.lastOpenId === id) ix.lastOpenId = null;
  writeIndex(ix);
}
function getLastOpen() { return readIndex().lastOpenId; }
function setLastOpen(id) { var ix = readIndex(); ix.lastOpenId = id; writeIndex(ix); }
