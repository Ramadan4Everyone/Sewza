/* SEWZA — Push notifications (phone alerts even when the app is closed).
   - Subscribes this device to Web Push and registers it with Supabase.
   - Lets the user switch notifications on/off and choose which alerts they want.
   - Alerts themselves are sent by the `sewza-push` Supabase Edge Function (see PUSH_SETUP.md). */
(function () {
  'use strict';

  var cfg = window.SEWZA_PUSH_CONFIG || {};
  var SETTINGS_KEY = 'sewza_v2_settings';        // same key app.js uses (we only read alarmTime)
  var PREFS_PREFIX = 'sewza_push_prefs_v1_';
  var ON_KEY = 'sewza_push_on';                  // holds the user id this device is switched on for

  var TYPES = [
    { id: 'delivery_reminder',   icon: '🔔', title: 'Delivery reminder',    desc: 'The day before a customer’s outfit is due.' },
    { id: 'delivery_today',      icon: '📅', title: 'Delivery due today',   desc: 'A morning heads-up for orders to deliver today.' },
    { id: 'order_reminder',      icon: '👕', title: 'Order reminder',       desc: 'Every Monday: unfinished orders due this week.' },
    { id: 'payment_received',    icon: '💰', title: 'Payment received',     desc: 'When you record a customer payment.' },
    { id: 'outstanding_payment', icon: '⚠️', title: 'Outstanding payment',  desc: 'Customers who still owe you a balance.' },
    { id: 'announcements',       icon: '📢', title: 'SEWZA announcements',  desc: 'Important news and new features.' }
  ];

  var els = {};
  var busy = false;
  var prefs = defaultPrefs();
  var prefsUid = null;
  var syncTimer = null;

  function $(s) { return document.querySelector(s); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function defaultPrefs() {
    var t = {};
    TYPES.forEach(function (x) { t[x.id] = true; });
    return { types: t };
  }
  function client() { return window.SEWZA_SUPABASE && window.SEWZA_SUPABASE.client || null; }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    } catch (e) { return false; }
  }
  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos'; } catch (e) { return 'Africa/Lagos'; }
  }
  function alarmTime() {
    try {
      var s = JSON.parse(lsGet(SETTINGS_KEY) || '{}');
      if (s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.alarmTime || '')) return s.alarmTime;
    } catch (e) {}
    return '08:00';
  }
  function urlB64ToUint8(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /* ---------- session ---------- */
  async function currentUser() {
    var c = client();
    if (!c) return null;
    try {
      var r = await c.auth.getSession();
      return r && r.data && r.data.session ? r.data.session.user : null;
    } catch (e) { return null; }
  }

  /* ---------- toast (re-uses the app's toast element) ---------- */
  function toast(title, msg) {
    var t = $('#toast'); if (!t) return;
    var b = t.querySelector('b'), s = t.querySelector('small');
    if (!b || !s) return;
    b.textContent = title; s.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove('show'); }, 3600);
  }

  /* ---------- preferences ---------- */
  function loadLocalPrefs(uid) {
    prefs = defaultPrefs(); prefsUid = uid;
    if (!uid) return;
    try {
      var saved = JSON.parse(lsGet(PREFS_PREFIX + uid) || 'null');
      if (saved && saved.types) TYPES.forEach(function (t) { if (typeof saved.types[t.id] === 'boolean') prefs.types[t.id] = saved.types[t.id]; });
    } catch (e) {}
  }
  function saveLocalPrefs() { if (prefsUid) lsSet(PREFS_PREFIX + prefsUid, JSON.stringify(prefs)); }

  async function pullServerPrefs(uid) {
    var c = client(); if (!c || !uid) return;
    try {
      var r = await c.from('push_prefs').select('types').eq('user_id', uid).maybeSingle();
      if (r && r.data && r.data.types) {
        TYPES.forEach(function (t) { if (typeof r.data.types[t.id] === 'boolean') prefs.types[t.id] = r.data.types[t.id]; });
        saveLocalPrefs();
      }
    } catch (e) { console.warn('SEWZA push: could not load settings', e); }
  }
  async function pushServerPrefs() {
    var c = client(); if (!c || !prefsUid) return false;
    try {
      var r = await c.from('push_prefs').upsert({
        user_id: prefsUid, types: prefs.types, reminder_time: alarmTime(), timezone: timeZone(), updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (r && r.error) throw r.error;
      return true;
    } catch (e) { console.warn('SEWZA push: could not save settings', e); return false; }
  }
  function schedulePrefsSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { if (isOnForUser()) pushServerPrefs(); }, 700);
  }

  function isOnForUser() { return !!prefsUid && lsGet(ON_KEY) === prefsUid; }

  /* ---------- service worker / subscription ---------- */
  function swReady() {
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Service worker not ready')); }, 8000); })
    ]);
  }
  async function getSub() {
    try { var reg = await swReady(); return await reg.pushManager.getSubscription(); } catch (e) { return null; }
  }
  async function registerSubOnServer(sub) {
    var j = sub.toJSON(), c = client();
    if (!c || !j.keys) throw new Error('Missing subscription keys');
    var r = await c.rpc('register_push_subscription', {
      p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: (navigator.userAgent || '').slice(0, 250)
    });
    if (r && r.error) throw r.error;
  }
  async function unregisterOnServer(endpoint) {
    var c = client(); if (!c || !endpoint) return;
    try { await c.rpc('unregister_push_subscription', { p_endpoint: endpoint }); } catch (e) {}
  }

  async function enable() {
    if (busy) return; busy = true; render();
    try {
      if (!supported()) { toast('Not supported', 'This browser cannot receive push notifications.'); return; }
      if (!cfg.vapidPublicKey) { toast('Not available yet', 'Push notifications are not set up on this SEWZA yet.'); return; }
      var user = await currentUser();
      if (!user) { toast('Sign in first', 'Sign in to turn on notifications.'); return; }
      loadLocalPrefs(user.id);

      var perm = Notification.permission;
      if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (e) { perm = Notification.permission; } }
      if (perm !== 'granted') {
        toast('Notifications blocked', 'Allow notifications for SEWZA in your browser settings, then try again.');
        return;
      }
      var reg = await swReady();
      var key = urlB64ToUint8(cfg.vapidPublicKey);
      var sub = await reg.pushManager.getSubscription();
      if (!sub) {
        try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
        catch (err) {
          // A subscription made with a different key can block a new one: clear it and retry once.
          var old = await reg.pushManager.getSubscription();
          if (old) { await old.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
          else throw err;
        }
      }
      try { await registerSubOnServer(sub); }
      catch (err) { console.warn('SEWZA push register failed', err); try { await sub.unsubscribe(); } catch (e) {} toast('Could not turn on', 'Please check your connection and try again.'); return; }
      lsSet(ON_KEY, user.id);
      await pullServerPrefs(user.id);
      await pushServerPrefs();
      toast('Notifications on', 'SEWZA will now alert you even when the app is closed.');
      try { await reg.showNotification('🔔 Notifications are on', { body: 'You will get SEWZA reminders on this phone.', icon: './icon-192.png', badge: './badge-96.png', tag: 'sewza-welcome' }); } catch (e) {}
    } catch (e) {
      console.warn('SEWZA push enable failed', e);
      toast('Could not turn on', 'Please check your connection and try again.');
    } finally { busy = false; render(); }
  }

  async function disable() {
    if (busy) return; busy = true; render();
    try {
      var sub = await getSub();
      lsDel(ON_KEY);
      if (sub) { var ep = sub.endpoint; try { await sub.unsubscribe(); } catch (e) {} await unregisterOnServer(ep); }
      toast('Notifications off', 'You will no longer get alerts on this device.');
    } finally { busy = false; render(); }
  }

  async function sendTest() {
    try {
      var reg = await swReady();
      await reg.showNotification('🔔 SEWZA test notification', {
        body: 'Great! Alerts will appear like this on your phone.', icon: './icon-192.png', badge: './badge-96.png', tag: 'sewza-test'
      });
    } catch (e) { toast('Test failed', 'Could not show a notification on this device.'); }
  }

  // Called by app.js after a payment is saved: tells the server to alert all of the user's devices.
  async function notifyPayment(name, amount) {
    try {
      if (!isOnForUser() || !cfg.vapidPublicKey || !navigator.onLine) return;
      var c = client(); if (!c || !c.functions) return;
      await c.functions.invoke('sewza-push', { body: { action: 'payment', customer: String(name || '').slice(0, 80), amount: Number(amount) } });
    } catch (e) { /* alerts are optional; never disturb the payment flow */ }
  }

  /* ---------- UI ---------- */
  function setToggle(btn, on) {
    if (!btn) return;
    btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var b = btn.querySelector('b'); if (b) b.textContent = on ? 'On' : 'Off';
  }
  async function render() {
    if (!els.panel) return;
    var user = await currentUser();
    if (user && prefsUid !== user.id) loadLocalPrefs(user.id);
    var status, canToggle = true, on = false;

    if (!supported()) {
      canToggle = false;
      status = isIOS() && !isStandalone()
        ? 'On iPhone: tap Install (or Share → Add to Home Screen) first, then open SEWZA from your home screen to turn this on.'
        : 'This browser does not support push notifications. Try Chrome on Android or the installed SEWZA app.';
    } else if (!cfg.vapidPublicKey) {
      canToggle = false; status = 'Push notifications are not available yet.';
    } else if (!user) {
      canToggle = false; status = 'Sign in to manage notifications.';
    } else if (Notification.permission === 'denied') {
      canToggle = false; status = 'Blocked in your browser settings. Allow notifications for SEWZA, then come back.';
    } else {
      var sub = await getSub();
      on = !!sub && Notification.permission === 'granted' && isOnForUser();
      status = on ? 'On — SEWZA alerts you even when the app is closed.' : 'Off — turn on for delivery, payment and order alerts on this phone.';
    }

    if (els.status) els.status.textContent = status;
    setToggle(els.master, on);
    els.master.disabled = !canToggle || busy;
    els.master.classList.toggle('is-busy', busy);
    if (els.test) els.test.hidden = !on;
    if (els.types) {
      els.types.classList.toggle('push-off', !on);
      els.types.innerHTML = TYPES.map(function (t) {
        var v = !!prefs.types[t.id];
        return '<div class="setting-row push-type"><div><b>' + t.icon + ' ' + t.title + '</b><small>' + t.desc + '</small></div>' +
          '<button class="toggle-btn' + (v ? ' on' : '') + '" type="button" data-push-type="' + t.id + '" aria-pressed="' + v + '" aria-label="' + t.title + '"><span></span><b>' + (v ? 'On' : 'Off') + '</b></button></div>';
      }).join('');
    }
  }

  function init() {
    els.panel = $('#pushPanel');
    if (!els.panel) return;
    els.master = $('#pushMasterToggle'); els.status = $('#pushStatus'); els.types = $('#pushTypes'); els.test = $('#pushTestBtn');

    els.master.addEventListener('click', function () { if (els.master.classList.contains('on')) disable(); else enable(); });
    els.test.addEventListener('click', sendTest);
    els.types.addEventListener('click', function (e) {
      var b = e.target.closest('[data-push-type]'); if (!b) return;
      var id = b.getAttribute('data-push-type');
      prefs.types[id] = !prefs.types[id];
      setToggle(b, prefs.types[id]);
      saveLocalPrefs(); schedulePrefsSync();
    });
    // Keep the server's reminder time in step with the app's "Reminder time" field.
    document.addEventListener('change', function (e) { if (e.target && e.target.id === 'alarmTime') schedulePrefsSync(); });

    // Messages from the service worker (a push arrived while the app is open).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        var d = e.data; if (d && d.type === 'sewza-push') toast(d.title || 'SEWZA', d.body || '');
      });
    }

    var c = client();
    if (c && c.auth && c.auth.onAuthStateChange) {
      c.auth.onAuthStateChange(function (event, session) {
        // Defer: calling Supabase inside this callback can dead-lock the client.
        setTimeout(async function () {
          if (event === 'SIGNED_OUT') {
            // Stop this phone receiving the previous user's alerts.
            lsDel(ON_KEY);
            prefs = defaultPrefs(); prefsUid = null;
            var s = await getSub();
            if (s) { var ep = s.endpoint; try { await s.unsubscribe(); } catch (e) {} await unregisterOnServer(ep); }
            render();
          } else if (session && session.user) {
            loadLocalPrefs(session.user.id);
            await pullServerPrefs(session.user.id);
            if (isOnForUser()) {
              var sub = await getSub();
              if (sub) { try { await registerSubOnServer(sub); } catch (e) {} }
              else if (Notification.permission === 'granted' && cfg.vapidPublicKey) {
                try { var reg = await swReady(); var ns = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(cfg.vapidPublicKey) }); await registerSubOnServer(ns); } catch (e) {}
              }
              pushServerPrefs();
            }
            render();
          }
        }, 0);
      });
    }
    // Re-check whenever the Help page is opened.
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-view="help"]')) setTimeout(render, 150);
    });
    render();
  }

  window.SEWZA_PUSH = { notifyPayment: notifyPayment, refresh: render };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
