/* SEWZA main menu — animated slide-in drawer opened from the top-right toggle.
   - Navigation items reuse the app's own [data-view] routing (bound in app.js), this file only
     opens/closes the drawer and adds small "go there and focus/scroll" helpers.
   - Also owns the "Text size" setting (stored on this device, applied through the --tx CSS variable). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var toggle = $('#menuToggle');
  var layer = $('#menuLayer');
  var drawer = $('#menuDrawer');
  var root = document.documentElement;
  if (!toggle || !layer || !drawer) return;

  var isOpen = false;
  var lastFocus = null;
  var TS_KEY = 'sewza_text_scale';

  /* ---------- open / close ---------- */
  function markCurrent() {
    var v = $('.view.active');
    var cur = v ? v.id.replace(/^view-/, '') : '';
    $$('.md-item, .md-tile', drawer).forEach(function (el) {
      var on = el.getAttribute('data-view') === cur &&
        !el.hasAttribute('data-menu-scroll') && !el.hasAttribute('data-menu-click') && !el.hasAttribute('data-menu-focus');
      el.classList.toggle('current', on);
      if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
  }

  function openMenu() {
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    markCurrent();
    drawer.style.transform = '';
    drawer.inert = false;
    layer.classList.add('open');
    layer.setAttribute('aria-hidden', 'false');
    toggle.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close menu');
    root.classList.add('menu-open');
    var body = $('.md-body', drawer); if (body) body.scrollTop = 0;
    setTimeout(function () { var c = $('.md-close', drawer); if (c) c.focus({ preventScroll: true }); }, 60);
  }

  function closeMenu(restoreFocus) {
    if (!isOpen) return;
    isOpen = false;
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    drawer.inert = true;
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    root.classList.remove('menu-open');
    drawer.style.transform = '';
    if (restoreFocus !== false) {
      try { toggle.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  toggle.addEventListener('click', function () { isOpen ? closeMenu() : openMenu(); });

  /* ---------- clicks inside the menu ---------- */
  layer.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-menu-close]')) { closeMenu(); return; }

    var el = t.closest('.md-item, .md-tile, .md-profile, .md-signout');
    if (!el || !drawer.contains(el)) return;

    var action = el.getAttribute('data-menu-action');
    var focusSel = el.getAttribute('data-menu-focus');
    var scrollSel = el.getAttribute('data-menu-scroll');
    var clickSel = el.getAttribute('data-menu-click');

    closeMenu(false); // navigation itself is handled by app.js through [data-view]

    if (action === 'signout') {
      var out = $('.sidebar [data-view="login"]');
      if (out) out.click();
    } else if (action === 'tour') {
      setTimeout(function () { var b = $('#helpTourBtn'); if (b) b.click(); }, 280);
    } else if (action === 'install') {
      setTimeout(function () { var b = $('#installAppBtn'); if (b) b.click(); }, 280);
    }
    if (clickSel) setTimeout(function () { var b = $(clickSel); if (b) b.click(); }, 320);
    if (scrollSel) setTimeout(function () {
      var s = $(scrollSel); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 360);
    if (focusSel) setTimeout(function () {
      var f = $(focusSel); if (f) { try { f.focus(); } catch (err) {} }
    }, 380);
  });

  /* ---------- keyboard: Esc closes, Tab stays inside ---------- */
  document.addEventListener('keydown', function (e) {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    if (e.key !== 'Tab') return;
    var f = $$('button:not([disabled]):not([hidden])', drawer).filter(function (b) { return b.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- swipe right to close (touch screens) ---------- */
  (function () {
    var sx = 0, sy = 0, dx = 0, tracking = false, horizontal = null;
    drawer.addEventListener('touchstart', function (e) {
      if (!isOpen || e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; tracking = true; horizontal = null;
    }, { passive: true });
    drawer.addEventListener('touchmove', function (e) {
      if (!tracking) return;
      var mx = e.touches[0].clientX - sx, my = e.touches[0].clientY - sy;
      if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horizontal = Math.abs(mx) > Math.abs(my) * 1.2;
      if (!horizontal) return;
      dx = Math.max(0, mx);
      drawer.style.transition = 'none';
      drawer.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });
    function end() {
      if (!tracking) return;
      tracking = false;
      drawer.style.transition = '';
      if (horizontal && dx > 80) closeMenu(); else drawer.style.transform = '';
    }
    drawer.addEventListener('touchend', end);
    drawer.addEventListener('touchcancel', end);
  })();

  /* ---------- keep the menu consistent with the app ---------- */
  // Close if the person lands on the sign-in screen (e.g. after signing out).
  new MutationObserver(function () {
    var login = $('#view-login');
    if (isOpen && login && login.classList.contains('active')) closeMenu(false);
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // Show "Install SEWZA app" in the menu only while the app can actually be installed.
  var installBtn = $('#installAppBtn'), mdInstall = $('.md-install', drawer);
  function syncInstall() { if (mdInstall && installBtn) mdInstall.hidden = installBtn.hidden; }
  if (installBtn && mdInstall) {
    new MutationObserver(syncInstall).observe(installBtn, { attributes: true, attributeFilter: ['hidden'] });
    syncInstall();
  }

  // Leaving a narrow layout while the menu is open should not leave the page locked.
  window.addEventListener('resize', function () { if (isOpen) drawer.style.transform = ''; });

  /* ---------- Text size (device setting) ---------- */
  function currentScale() {
    var v = NaN;
    try { v = parseFloat(localStorage.getItem(TS_KEY)); } catch (e) {}
    return (v >= 1 && v <= 1.4) ? v : 1;
  }
  function paintScale(v) {
    $$('.ts-seg button[data-ts]').forEach(function (b) {
      b.setAttribute('aria-pressed', Math.abs(parseFloat(b.getAttribute('data-ts')) - v) < 0.001 ? 'true' : 'false');
    });
  }
  function setScale(v) {
    root.style.setProperty('--tx', String(v));
    try { localStorage.setItem(TS_KEY, String(v)); } catch (e) {}
    paintScale(v);
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.ts-seg button[data-ts]') : null;
    if (b) setScale(parseFloat(b.getAttribute('data-ts')));
  });
  paintScale(currentScale());
})();
