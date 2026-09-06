"use strict";
// 共有リンク・バックアップファイルの符号化/復号。DOMに依存しない(ブラウザ・Nodeどちらでも動く)。

// Uint8Array → 2進文字列 → btoa という一本道で書く(Node18+/ブラウザどちらにも btoa/atob がある)
function base64urlEncode(u8) {
  var bin = "";
  for (var i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  var b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlDecode(str) {
  var b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  var bin = atob(b64);
  var u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function compressBytes(u8) {
  var stream = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  var buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
// 展開結果を丸ごと Response#arrayBuffer に任せると、悪意ある(または壊れた)短い圧縮データが
// 巨大な展開結果に化ける「圧縮爆弾」を許してしまう。チャンクごとに読み、合計が上限を超えたら打ち切る
var DECOMPRESS_MAX_BYTES = 2 * 1024 * 1024;
async function decompressBytes(u8) {
  var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  var reader = stream.getReader();
  var chunks = [], total = 0;
  while (true) {
    var res = await reader.read();
    if (res.done) break;
    total += res.value.length;
    if (total > DECOMPRESS_MAX_BYTES) {
      reader.cancel().catch(function () {});
      throw new Error("展開後のデータが大きすぎます");
    }
    chunks.push(res.value);
  }
  var out = new Uint8Array(total), offset = 0;
  chunks.forEach(function (c) { out.set(c, offset); offset += c.length; });
  return out;
}

// id・createdAt・updatedAt を除いた曲データを "z"(圧縮)/"r"(無圧縮)+base64url の文字列にする
async function encodeShare(score) {
  var copy = Object.assign({}, score);
  delete copy.id; delete copy.createdAt; delete copy.updatedAt;
  var bytes = new TextEncoder().encode(JSON.stringify(copy));
  if (typeof CompressionStream !== "undefined") {
    try {
      var compressed = await compressBytes(bytes);
      return "z" + base64urlEncode(compressed);
    } catch (e) { /* 圧縮に失敗したら無圧縮にフォールバック */ }
  }
  return "r" + base64urlEncode(bytes);
}

async function decodeShare(str) {
  try {
    if (typeof str !== "string" || str.length < 1) throw new Error("empty");
    var kind = str[0], body = str.slice(1);
    var bytes = base64urlDecode(body);
    if (kind === "z") bytes = await decompressBytes(bytes);
    else if (kind !== "r") throw new Error("unknown share kind");
    var json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch (e) {
    throw new Error("共有リンクを読めませんでした");
  }
}

async function shareUrl(baseUrl, score) {
  var url = baseUrl + "#s=" + (await encodeShare(score));
  if (url.length > 30000) throw new Error("曲が大きすぎてリンクにできません。JSONで送ってください");
  return url;
}

function parseShareHash(hash) {
  if (typeof hash !== "string") return null;
  var m = /^#s=(.+)$/.exec(hash);
  return m ? m[1] : null;
}

function makeBackup(scores) {
  return { format: "piano-fusen-backup", version: 1, exportedAt: new Date().toISOString(), scores: scores };
}

// バックアップ(複数曲)か単曲かを判定する。正規化は呼び出し側が normalizeScore で行う
function parseImport(text) {
  var obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error("この形式のファイルは読み込めません"); }
  if (obj && obj.format === "piano-fusen-backup" && Array.isArray(obj.scores)) {
    return { kind: "backup", scores: obj.scores };
  }
  if (obj && Array.isArray(obj.events)) {
    return { kind: "score", scores: [obj] };
  }
  throw new Error("この形式のファイルは読み込めません");
}

if (typeof module !== "undefined") module.exports = {
  encodeShare: encodeShare, decodeShare: decodeShare, shareUrl: shareUrl, parseShareHash: parseShareHash,
  makeBackup: makeBackup, parseImport: parseImport,
  base64urlEncode: base64urlEncode, base64urlDecode: base64urlDecode,
  compressBytes: compressBytes, decompressBytes: decompressBytes
};
