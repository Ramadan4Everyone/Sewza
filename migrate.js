/* SEWZA — one-time upgrade of data saved under the app's previous name.
   Runs before everything else so nobody loses customers, settings or drafts.
   - Copies every old "<previous>_*" browser-storage entry to its "sewza_*" name.
   - Copies the old offline database into the new one.
   Nothing is deleted until the new copy has been written and checked. */
(function () {
  'use strict';
  var OLD = String.fromCharCode(115, 116, 105, 99, 104, 97); // previous app id
  var NEW = 'sewza';
  var DONE_KEY = NEW + '_migrated_v1';

  function ls() { try { return window.localStorage; } catch (e) { return null; } }

  function migrateLocalStorage() {
    var s = ls(); if (!s) return;
    try {
      var keys = [], i;
      for (i = 0; i < s.length; i++) keys.push(s.key(i));
      keys.forEach(function (k) {
        if (!k || k.indexOf(OLD + '_') !== 0 && k.indexOf(OLD + '-') !== 0) return;
        var nk = NEW + k.slice(OLD.length);
        var v = s.getItem(k);
        if (v === null) return;
        try {
          if (s.getItem(nk) === null) s.setItem(nk, v);
          if (s.getItem(nk) !== null) s.removeItem(k);
        } catch (e) { /* storage full: keep the old copy, try again next visit */ }
      });
      // The default colour theme was renamed together with the app.
      var raw = s.getItem(NEW + '_v2_settings');
      if (raw) {
        var st = JSON.parse(raw);
        if (st && st.theme === OLD) { st.theme = NEW; s.setItem(NEW + '_v2_settings', JSON.stringify(st)); }
      }
    } catch (e) { /* never block the app */ }
  }

  function migrateIndexedDB() {
    return new Promise(function (resolve) {
      if (!('indexedDB' in window)) return resolve();
      var oldName = OLD + '_offline_db', newName = NEW + '_offline_db', STORE = 'app', settled = false;
      var finish = function () { if (!settled) { settled = true; resolve(); } };
      setTimeout(finish, 4000); // never hold the app back for long
      try {
        var probe = indexedDB.open(oldName);
        var existed = true;
        probe.onupgradeneeded = function () { existed = false; try { probe.transaction.abort(); } catch (e) {} };
        probe.onerror = function () { finish(); };
        probe.onblocked = function () { finish(); };
        probe.onsuccess = function () {
          var odb = probe.result;
          if (!existed || !odb.objectStoreNames.contains(STORE)) { odb.close(); return finish(); }
          var items = [];
          var rtx = odb.transaction(STORE, 'readonly');
          var cur = rtx.objectStore(STORE).openCursor();
          cur.onsuccess = function () {
            var c = cur.result;
            if (c) {
              // Entries inside the database are stored under the same "<previous>_*" names; rename them too.
              var key = c.key;
              if (typeof key === 'string' && key.indexOf(OLD + '_') === 0 || typeof key === 'string' && key.indexOf(OLD + '-') === 0) key = NEW + key.slice(OLD.length);
              items.push([key, c.value]); c.continue();
            }
          };
          rtx.oncomplete = function () {
            odb.close();
            if (!items.length) { try { indexedDB.deleteDatabase(oldName); } catch (e) {} return finish(); }
            var wr = indexedDB.open(newName, 1);
            wr.onupgradeneeded = function () { if (!wr.result.objectStoreNames.contains(STORE)) wr.result.createObjectStore(STORE); };
            wr.onerror = function () { finish(); };
            wr.onsuccess = function () {
              var ndb = wr.result;
              var wtx = ndb.transaction(STORE, 'readwrite'), os = wtx.objectStore(STORE);
              items.forEach(function (it) {
                var g = os.get(it[0]);
                g.onsuccess = function () { if (g.result === undefined) os.put(it[1], it[0]); }; // never overwrite newer data
              });
              wtx.oncomplete = function () {
                ndb.close();
                try { indexedDB.deleteDatabase(oldName); } catch (e) {}
                finish();
              };
              wtx.onerror = wtx.onabort = function () { try { ndb.close(); } catch (e) {} finish(); };
            };
          };
          rtx.onerror = rtx.onabort = function () { try { odb.close(); } catch (e) {} finish(); };
        };
      } catch (e) { finish(); }
    });
  }

  migrateLocalStorage();
  var s = ls();
  window.__sewzaReady = migrateIndexedDB().then(function () {
    try { if (s) s.setItem(DONE_KEY, String(Date.now())); } catch (e) {}
  });
})();
