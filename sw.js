"use strict";
var VERSION = "202609061802";            // deploy.ps1 が yyyyMMddHHmm に置き換える。ソースのままなら開発版
var CACHE = "piano-fusen-" + VERSION;
var DEV = !/^[0-9]{12}$/.test(VERSION);   // 配布時のスタンプ(12桁の日時)が入っていなければ開発中。トークン名を書くと置換に巻き込まれるので正規表現で判定
var FILES = ["./", "./index.html", "./manifest.webmanifest", "./js/model.js", "./js/storage.js", "./js/share.js", "./js/render.js", "./js/playback.js", "./js/edit.js", "./js/app.js", "./js/recognizer.js", "./vendor/vexflow.js", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("piano-fusen-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  if (DEV) return;  // 開発中はキャッシュを使わない(常に最新のファイルを取りに行く)
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.indexOf("/vendor/basic-pitch") >= 0) {
    // 認識部品は大きいので先読みせず、初めて使ったときに保存する
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(e.request).then(function (r) {
          if (r) return r;
          return fetch(e.request).then(function (res) {
            if (res.ok) c.put(e.request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }
  var isNavigate = e.request.mode === "navigate";
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(e.request, { ignoreSearch: true }).then(function (r) {
        if (r) return r;
        return fetch(e.request).catch(function () {
          if (isNavigate) return c.match("./index.html");
          return Promise.reject();
        });
      });
    })
  );
});

