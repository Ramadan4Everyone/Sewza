/* SEWZA — PWA registration and first-visit "Install app" prompt. */
(function () {
  'use strict';

  var SEEN_KEY = 'sewza_install_prompt_v1'; // set once the prompt has been shown (first visit only)
  var sheet, installBtn, helpBtn, yesBtn, laterBtn, stepsEl, textEl, titleEl;
  var shownThisPage = false;

  function $(s) { return document.querySelector(s); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var justInstalled = false;
  // True when SEWZA is running as the installed app (not in a normal browser tab).
  function isStandalone() {
    try {
      if (window.navigator.standalone === true) return true;
      if (document.referrer && document.referrer.indexOf('android-app://') === 0) return true;
      if (window.matchMedia) {
        var modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
        for (var i = 0; i < modes.length; i++) {
          if (window.matchMedia('(display-mode: ' + modes[i] + ')').matches) return true;
        }
      }
    } catch (e) {}
    return false;
  }
  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function hasNativePrompt() { return !!window.__sewzaInstallPrompt; }

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.setAttribute('hidden', ''); else el.removeAttribute('hidden');
  }
  function refreshButtons() {
    // Always offered on the web; only hidden inside the installed app.
    var can = !isStandalone() && !justInstalled;
    setHidden(installBtn, !can);
    setHidden(helpBtn, !can);
  }

  var IOS_STEPS = '<li><span>1</span><div>Tap the <b>Share</b> button <i class="ios-share" aria-hidden="true"></i> in Safari.</div></li>' +
    '<li><span>2</span><div>Scroll down and tap <b>Add to Home Screen</b>.</div></li>' +
    '<li><span>3</span><div>Tap <b>Add</b>. SEWZA now lives on your home screen.</div></li>';
  var MANUAL_STEPS = '<li><span>1</span><div>Open your browser menu (<b>\u22EE</b> or <b>\u22EF</b>, or the address bar icon).</div></li>' +
    '<li><span>2</span><div>Choose <b>Install SEWZA</b> or <b>Add to Home screen</b>.</div></li>' +
    '<li><span>3</span><div>Confirm. SEWZA now opens like a real app.</div></li>';

  function openSheet(mode) {
    if (!sheet || isStandalone()) return;
    var ios = mode === 'ios';
    var guide = ios || mode === 'manual';
    if (stepsEl && guide) stepsEl.innerHTML = ios ? IOS_STEPS : MANUAL_STEPS;
    setHidden(stepsEl, !guide);
    if (titleEl) titleEl.textContent = 'Install SEWZA';
    if (textEl) textEl.textContent = ios
      ? 'Add SEWZA to your home screen in three quick taps. It then opens like a real app and works offline.'
      : mode === 'manual'
        ? 'Your browser will install SEWZA from its menu. It then opens like a real app and works offline.'
        : 'Add SEWZA to your home screen. It opens like a real app, loads faster and keeps working offline.';
    if (yesBtn) { yesBtn.textContent = guide ? 'Got it' : 'Install app'; yesBtn.dataset.mode = mode; }
    if (laterBtn) setHidden(laterBtn, guide);
    sheet.classList.add('show');
    sheet.setAttribute('aria-hidden', 'false');
    shownThisPage = true;
    lsSet(SEEN_KEY, String(Date.now()));
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('show');
    sheet.setAttribute('aria-hidden', 'true');
  }

  async function runNativeInstall() {
    var ev = window.__sewzaInstallPrompt;
    if (!ev) return;
    try {
      ev.prompt();
      await ev.userChoice;
    } catch (e) { /* the browser refused or the user closed it */ }
    window.__sewzaInstallPrompt = null;
    refreshButtons();
  }

  // The first time someone opens SEWZA, ask once whether they would like to install it.
  function maybeShowFirstVisit() {
    if (shownThisPage || lsGet(SEEN_KEY) || isStandalone()) return;
    if (hasNativePrompt()) openSheet('native');
    else if (isIOS()) openSheet('ios');
    // Other browsers: the sheet appears as soon as the browser offers installation (see 'sewza:installready').
  }

  function whenAppIsReady(fn) {
    // Wait until the animated SEWZA logo intro has finished.
    if (!document.body.classList.contains('booting')) { setTimeout(fn, 900); return; }
    var mo = new MutationObserver(function () {
      if (!document.body.classList.contains('booting')) { mo.disconnect(); setTimeout(fn, 1100); }
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function init() {
    sheet = $('#installSheet');
    installBtn = $('#installAppBtn');
    helpBtn = $('#helpInstallBtn');
    yesBtn = $('#installYes');
    laterBtn = $('#installLater');
    stepsEl = $('#installSteps');
    textEl = $('#installText');
    titleEl = $('#installTitle');

    refreshButtons();

    function manualInstall() {
      if (hasNativePrompt()) runNativeInstall();
      else if (isIOS()) openSheet('ios');
      else openSheet('manual');
    }
    if (installBtn) installBtn.addEventListener('click', manualInstall);
    if (helpBtn) helpBtn.addEventListener('click', manualInstall);

    if (yesBtn) yesBtn.addEventListener('click', function () {
      var mode = yesBtn.dataset.mode;
      closeSheet();
      if (mode === 'native') runNativeInstall();
    });
    if (laterBtn) laterBtn.addEventListener('click', closeSheet);
    if (sheet) sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

    window.addEventListener('sewza:installready', function () {
      refreshButtons();
      whenAppIsReady(maybeShowFirstVisit);
    });
    window.addEventListener('appinstalled', function () {
      window.__sewzaInstallPrompt = null;
      justInstalled = true;
      closeSheet();
      lsSet(SEEN_KEY, String(Date.now()));
      refreshButtons();
    });

    whenAppIsReady(maybeShowFirstVisit);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Service worker (offline support + installability).
  window.addEventListener('load', function () {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function (err) { console.warn('SEWZA service worker:', err); });
    }
  });
})();
