/* SEWZA public tailor portfolio. Reads one published portfolio from Supabase (read-only, no login). */
(function () {
  'use strict';
  var cfg = window.SEWZA_SUPABASE_CONFIG || {};
  var BASE = String(cfg.url || '').replace(/\/$/, '');
  var KEY = cfg.anonKey || '';
  var MEDIA = BASE + '/storage/v1/object/public/portfolio-media/';
  var app = document.getElementById('app');
  var lb = document.getElementById('ppLightbox');
  var toastEl = document.getElementById('ppToast');
  var P = null;            // the portfolio being shown
  var shown = [];          // works currently visible (after the category filter)
  var cat = 'All';
  var lbIndex = 0, lastFocus = null, toastTimer = null;

  // ---------- helpers ----------
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function str(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n); }
  function media(u) { return typeof u === 'string' && BASE && u.indexOf(MEDIA) === 0 ? u : ''; }
  function link(u) { try { var x = new URL(String(u)); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch (e) { return ''; } }
  function slugFromUrl() {
    var q = new URLSearchParams(location.search), t = q.get('t') || q.get('u') || '';
    if (!t && location.hash) t = location.hash.slice(1);
    t = String(t).trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]{2,39}$/.test(t) ? t : '';
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }
  var ICON = {
    pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>',
    share: '<circle cx="6" cy="12" r="2.4"/><circle cx="17.5" cy="6" r="2.4"/><circle cx="17.5" cy="18" r="2.4"/><path d="m8.2 10.9 7.1-3.8M8.2 13.1l7.1 3.8"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    ig: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="17" cy="7" r=".6"/>',
    tt: '<path d="M14 4v10.2a3.7 3.7 0 1 1-3.7-3.7"/><path d="M14 4c.4 2.4 1.9 3.9 4.4 4.1"/>',
    fb: '<path d="M14.5 21v-8h2.8l.5-3.3h-3.3V7.6c0-1 .4-1.7 1.8-1.7h1.6V3.1A20 20 0 0 0 15.6 3C13 3 11.2 4.600 11.200 7.300v2.400H8.500V13h2.700v8z"/>',
    x: '<path d="M5 4.500l14 15M19 4.500 5 19.500"/>',
    yt: '<rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10.500 9.500 4 2.500-4 2.500z"/>',
    web: '<circle cx="12" cy="12" r="8.500"/><path d="M3.500 12h17M12 3.500c2.400 2.500 3.500 5.300 3.500 8.500s-1.100 6-3.500 8.500c-2.400-2.500-3.500-5.300-3.500-8.500s1.100-6 3.500-8.500z"/>',
    x2: '<path d="M6 6l12 12M18 6 6 18"/>',
    l: '<path d="m14.500 5-7 7 7 7"/>',
    r: '<path d="m9.500 5 7 7-7 7"/>'
  };
  function ic(n) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  var SOCIALS = [['instagram', 'ig', 'Instagram'], ['tiktok', 'tt', 'TikTok'], ['facebook', 'fb', 'Facebook'], ['twitter', 'x', 'X (Twitter)'], ['youtube', 'yt', 'YouTube'], ['website', 'web', 'Website']];

  // ---------- data ----------
  function normalize(r) {
    var works = (Array.isArray(r.works) ? r.works : []).map(function (w) {
      return w && typeof w === 'object' ? { id: str(w.id, 60), url: media(w.url), title: str(w.title, 70), category: str(w.category, 40), caption: str(w.caption, 240) } : null;
    }).filter(function (w) { return w && w.url; }).slice(0, 60);
    var soc = {}, src = r.socials && typeof r.socials === 'object' ? r.socials : {};
    SOCIALS.forEach(function (s) { var l = link(src[s[0]]); if (l) soc[s[0]] = l; });
    var wa = String(r.whatsapp || '').replace(/\D/g, '');
    return {
      slug: str(r.slug, 40), name: str(r.business_name, 80) || 'Tailor', tagline: str(r.tagline, 120), about: str(r.about, 900),
      location: str(r.location, 100), wa: wa.length >= 8 && wa.length <= 15 ? wa : '', logo: media(r.logo_url),
      socials: soc, specialties: (Array.isArray(r.specialties) ? r.specialties : []).map(function (x) { return str(x, 40); }).filter(Boolean).slice(0, 10), works: works
    };
  }
  function fetchWithTimeout(url, opts, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, t = ctl && setTimeout(function () { ctl.abort(); }, ms || 15000);
    if (ctl) opts.signal = ctl.signal;
    return fetch(url, opts).finally(function () { if (t) clearTimeout(t); });
  }
  function load(slug) {
    var url = BASE + '/rest/v1/tailor_portfolios?slug=eq.' + encodeURIComponent(slug) + '&published=eq.true&select=*&limit=1';
    return fetchWithTimeout(url, { headers: { apikey: KEY, Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
      return res.json();
    }).then(function (rows) { return Array.isArray(rows) && rows[0] ? normalize(rows[0]) : null; });
  }
  function track(slug) {
    try {
      var k = 'sewza_pf_seen_' + slug; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1');
      fetch(BASE + '/rest/v1/rpc/portfolio_track', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_slug: slug }), keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  // ---------- whatsapp / share ----------
  function waUrl(text) { return P && P.wa ? 'https://wa.me/' + P.wa + '?text=' + encodeURIComponent(text) : ''; }
  function waGeneral() { return waUrl('Hello ' + P.name + ', I found your portfolio on SEWZA and I would like to place an order.'); }
  function waDesign(w) { return waUrl('Hello ' + P.name + ', I saw ' + (w.title ? '"' + w.title + '"' : 'a design') + ' on your SEWZA portfolio and I would like something like it. Please let me know the price and how long it takes.'); }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, no) {
      try { var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); var d = document.execCommand('copy'); document.body.removeChild(t); d ? ok() : no(); } catch (e) { no(e); }
    });
  }
  function share() {
    var url = location.href.split('#')[0], title = P.name + ' — Tailor Portfolio';
    if (navigator.share) { navigator.share({ title: title, text: 'See the latest work by ' + P.name, url: url }).catch(function () {}); return; }
    copyText(url).then(function () { toast('Link copied. Send it to anyone.'); }, function () { toast('Copy this page address from your browser.'); });
  }

  // ---------- render ----------
  function gone(title, msg, retry) {
    document.title = 'Portfolio — SEWZA';
    document.body.classList.remove('has-dock');
    app.innerHTML = '<div class="pp-gone"><div class="box"><img src="icon-192.png" alt="SEWZA"><h1>' + esc(title) + '</h1><p>' + esc(msg) + '</p>' +
      (retry ? '<button class="pp-btn dark" id="ppRetry" type="button">Try again</button>' : '<a class="pp-btn dark" href="index.html">Visit SEWZA</a>') + '</div></div>';
    var b = document.getElementById('ppRetry'); if (b) b.addEventListener('click', start);
  }
  function categories() {
    var seen = {}, list = [];
    P.works.forEach(function (w) { if (w.category && !seen[w.category]) { seen[w.category] = 1; list.push(w.category); } });
    return list;
  }
  function hero() {
    var initial = esc((P.name.charAt(0) || 'S').toUpperCase());
    var logo = P.logo ? '<img src="' + esc(P.logo) + '" alt="' + esc(P.name) + ' logo">' : '<span>' + initial + '</span>';
    var socials = SOCIALS.filter(function (s) { return P.socials[s[0]]; }).map(function (s) {
      return '<a class="pp-soc" href="' + esc(P.socials[s[0]]) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(s[2]) + '">' + ic(s[1]) + '</a>';
    }).join('');
    var meta = (P.location ? '<span class="pp-pill">' + ic('pin') + esc(P.location) + '</span>' : '') +
      (P.works.length ? '<span class="pp-pill gold">' + ic('spark') + P.works.length + (P.works.length === 1 ? ' design' : ' designs') + '</span>' : '');
    var specs = P.specialties.slice(0, 4).map(function (s) { return '<span class="pp-pill">' + esc(s) + '</span>'; }).join('');
    var cta = (P.wa ? '<a class="pp-btn gold" href="' + esc(waGeneral()) + '" target="_blank" rel="noopener noreferrer">' + ic('chat') + 'Order on WhatsApp</a>' : '') +
      '<button class="pp-btn ghost" type="button" data-share>' + ic('share') + 'Share</button>';
    var c = P.works.slice(0, 3), collage;
    if (c.length >= 2) collage = '<div class="pp-collage" aria-hidden="true">' + c.map(function (w, i) { return '<div class="pp-card c' + (i + 1) + '"><img src="' + esc(w.url) + '" alt="" loading="eager" decoding="async"></div>'; }).join('') + '</div>';
    else if (c.length === 1) collage = '<div class="pp-collage" aria-hidden="true"><div class="pp-card only"><img src="' + esc(c[0].url) + '" alt="" decoding="async"></div></div>';
    else collage = '<div class="pp-art" aria-hidden="true">' + initial + '</div>';
    return '<header class="pp-hero"><div class="pp-top"><div class="pp-wrap"><a class="pp-brand" href="index.html"><img src="icon-192.png" alt="">SEWZA</a><button class="pp-glass" type="button" data-share>' + ic('share') + 'Share</button></div></div>' +
      '<div class="pp-wrap pp-hero-inner"><div class="pp-id"><div class="pp-logo">' + logo + '</div><p class="pp-kicker">Tailor &amp; fashion designer</p><h1 class="pp-name">' + esc(P.name) + '</h1>' +
      (P.tagline ? '<p class="pp-tag">' + esc(P.tagline) + '</p>' : '') + '<div class="pp-meta">' + meta + specs + '</div><div class="pp-cta">' + cta + '</div>' + (socials ? '<div class="pp-socials">' + socials + '</div>' : '') + '</div>' + collage + '</div>' +
      '<div class="pp-wave" aria-hidden="true"><svg viewBox="0 0 1440 70" preserveAspectRatio="none"><path fill="currentColor" d="M0 40C240 80 480 0 720 24s480 52 720 8V70H0z"/></svg></div></header>';
  }
  function stats() {
    var items = [[P.works.length, P.works.length === 1 ? 'Design' : 'Designs'], [P.specialties.length || '—', 'Specialties'], [P.location ? '<span style="font-size:.52em;font-family:Manrope,sans-serif;font-weight:800;display:block;line-height:1.25;overflow-wrap:anywhere">' + esc(P.location.split(',')[0]) + '</span>' : '—', 'Based in']];
    return '<div class="pp-wrap"><div class="pp-stats">' + items.map(function (i) { return '<div class="pp-stat"><b>' + i[0] + '</b><span>' + i[1] + '</span></div>'; }).join('') + '</div></div>';
  }
  function gallery() {
    var cats = categories();
    var filters = cats.length > 1 ? '<div class="pp-filters" role="tablist" aria-label="Filter designs">' + ['All'].concat(cats).map(function (c) {
      var n = c === 'All' ? P.works.length : P.works.filter(function (w) { return w.category === c; }).length;
      return '<button type="button" role="tab" class="pp-chip' + (c === cat ? ' on' : '') + '" data-cat="' + esc(c) + '" aria-selected="' + (c === cat) + '">' + esc(c) + '<small>' + n + '</small></button>';
    }).join('') + '</div>' : '';
    return '<section class="pp-section" id="work"><div class="pp-wrap"><p class="pp-eyebrow">The collection</p><h2 class="pp-h2">Finished work you can order today</h2><p class="pp-sub">Tap any design to see it bigger, then message ' + esc(P.name) + ' to get yours made.</p>' + filters +
      (P.works.length ? '<div class="pp-grid" id="ppGrid"></div>' : '<div class="pp-empty"><b>New designs coming soon</b>This tailor is still adding photos. Message them on WhatsApp to see more of their work.</div>') + '</div></section>';
  }
  function aboutSpec() {
    var a = P.about ? '<div class="pp-card2 pp-about"><p class="pp-eyebrow" style="font-family:Manrope,sans-serif;margin-bottom:12px">About us</p><p>' + esc(P.about) + '</p></div>' : '';
    var s = P.specialties.length ? '<div class="pp-card2"><p class="pp-eyebrow" style="margin-bottom:14px">What we make best</p><ul class="pp-spec">' + P.specialties.map(function (x) { return '<li><i>' + ic('spark') + '</i><span>' + esc(x) + '</span></li>'; }).join('') + '</ul></div>' : '';
    if (!a && !s) return '';
    return '<section class="pp-section"><div class="pp-wrap"><div class="pp-two' + (a && s ? ' both' : '') + '">' + a + s + '</div></div></section>';
  }
  function steps() {
    return '<section class="pp-section"><div class="pp-wrap"><p class="pp-eyebrow">Simple &amp; stress-free</p><h2 class="pp-h2">How to order</h2><div class="pp-steps">' +
      '<div class="pp-step"><b>Choose your style</b><p>Pick a design you love from the collection, or describe your own idea.</p></div>' +
      '<div class="pp-step"><b>Get measured</b><p>Your measurements are saved safely in a digital book, so every fitting is accurate.</p></div>' +
      '<div class="pp-step"><b>Collect on time</b><p>Agree a delivery date and get your outfit ready for the big day.</p></div></div></div></section>';
  }
  function band() {
    var socials = SOCIALS.filter(function (s) { return P.socials[s[0]]; }).map(function (s) { return '<a class="pp-soc" href="' + esc(P.socials[s[0]]) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(s[2]) + '">' + ic(s[1]) + '</a>'; }).join('');
    return '<div class="pp-wrap"><section class="pp-band"><h2>Ready for your next outfit?</h2><p>Send ' + esc(P.name) + ' a message and get a quote for the design you want.</p>' +
      (P.location ? '<div class="pp-addr">' + ic('pin') + esc(P.location) + '</div>' : '') +
      '<div class="pp-cta">' + (P.wa ? '<a class="pp-btn gold" href="' + esc(waGeneral()) + '" target="_blank" rel="noopener noreferrer">' + ic('chat') + 'Chat on WhatsApp</a>' : '') + '<button class="pp-btn ghost" type="button" data-share>' + ic('share') + 'Share this page</button></div>' +
      (socials ? '<div class="pp-socials" style="justify-content:center">' + socials + '</div>' : '') + '</section></div>';
  }
  function footer() {
    return '<footer class="pp-foot"><div class="pp-wrap"><a class="pp-brand" href="index.html"><img src="icon-192.png" alt="">SEWZA</a><p>The digital measurement book for modern tailors.</p><p style="margin-top:6px">Are you a tailor? <a href="index.html">Create your own portfolio on SEWZA</a></p></div></footer>';
  }
  function dock() {
    return '<div class="pp-dock">' + (P.wa ? '<a class="pp-btn gold" href="' + esc(waGeneral()) + '" target="_blank" rel="noopener noreferrer">' + ic('chat') + 'Order on WhatsApp</a>' : '') +
      '<button class="pp-share" type="button" data-share aria-label="Share this portfolio">' + ic('share') + '</button></div>';
  }
  function render() {
    document.title = P.name + ' — Tailor Portfolio | SEWZA';
    var d = (P.tagline || ('Finished clothes by ' + P.name + (P.location ? ' in ' + P.location : '') + '. Order on WhatsApp.')).slice(0, 155);
    [['meta[name="description"]', d], ['meta[property="og:title"]', document.title], ['meta[property="og:description"]', d]].forEach(function (x) { var m = document.querySelector(x[0]); if (m) m.setAttribute('content', x[1]); });
    document.body.classList.add('has-dock');
    app.innerHTML = hero() + stats() + gallery() + aboutSpec() + steps() + band() + footer() + dock();
    drawGrid();
  }
  var io = null;
  function drawGrid() {
    var grid = document.getElementById('ppGrid'); if (!grid) return;
    shown = cat === 'All' ? P.works : P.works.filter(function (w) { return w.category === cat; });
    grid.innerHTML = shown.map(function (w, i) {
      return '<button type="button" class="pp-tile" data-i="' + i + '" aria-label="Open ' + esc(w.title || 'design ' + (i + 1)) + '"><img src="' + esc(w.url) + '" alt="' + esc(w.title || (P.name + ' design ' + (i + 1))) + '" loading="lazy" decoding="async">' +
        ((w.title || w.category) ? '<span class="pp-tcap">' + (w.title ? '<b>' + esc(w.title) + '</b>' : '') + (w.category ? '<span>' + esc(w.category) + '</span>' : '') + '</span>' : '') + '</button>';
    }).join('');
    if (io) io.disconnect();
    var tiles = grid.querySelectorAll('.pp-tile');
    tiles.forEach(function (t) {
      var im = t.querySelector('img'), done = function () { t.classList.add('loaded'); };
      if (im.complete) done(); else { im.addEventListener('load', done); im.addEventListener('error', done); }
    });
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -6% 0px', threshold: .05 });
      tiles.forEach(function (t, i) { t.style.transitionDelay = Math.min(i % 6, 5) * 60 + 'ms'; io.observe(t); });
    } else tiles.forEach(function (t) { t.classList.add('in'); });
    // Safety net: never leave a design hidden if the scroll observer is slow or unsupported.
    setTimeout(function () { tiles.forEach(function (t) { t.classList.add('in'); }); }, 2500);
  }

  // ---------- lightbox ----------
  function openLb(i) {
    if (!shown.length) return;
    lbIndex = (i + shown.length) % shown.length;
    var w = shown[lbIndex]; if (!lb.classList.contains('show')) lastFocus = document.activeElement;
    var wa = P.wa ? '<a class="pp-btn gold" href="' + esc(waDesign(w)) + '" target="_blank" rel="noopener noreferrer">' + ic('chat') + 'Ask about this design</a>' : '';
    lb.innerHTML = '<div class="pp-lb-bar"><span>' + (lbIndex + 1) + ' / ' + shown.length + '</span><button class="pp-lb-x" type="button" data-lb-close aria-label="Close">' + ic('x2') + '</button></div>' +
      '<div class="pp-lb-stage">' + (shown.length > 1 ? '<button class="pp-lb-nav prev" type="button" data-lb-prev aria-label="Previous design">' + ic('l') + '</button><button class="pp-lb-nav next" type="button" data-lb-next aria-label="Next design">' + ic('r') + '</button>' : '') +
      '<img src="' + esc(w.url) + '" alt="' + esc(w.title || 'Design') + '"></div>' +
      '<div class="pp-lb-info">' + (w.category ? '<small>' + esc(w.category) + '</small>' : '') + (w.title ? '<b>' + esc(w.title) + '</b>' : '') + (w.caption ? '<p>' + esc(w.caption) + '</p>' : '') + wa + '</div>';
    lb.classList.add('show'); lb.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    var c = lb.querySelector('[data-lb-close]'); if (c) c.focus({ preventScroll: true });
    [1, -1].forEach(function (d) { var n = shown[(lbIndex + d + shown.length) % shown.length]; if (n) { var im = new Image(); im.src = n.url; } });
  }
  function closeLb() {
    lb.classList.remove('show'); lb.setAttribute('aria-hidden', 'true'); lb.innerHTML = ''; document.body.style.overflow = '';
    if (lastFocus && document.contains(lastFocus)) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }

  // ---------- events (bound once) ----------
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('[data-share]')) { share(); return; }
    var chip = t.closest('[data-cat]'); if (chip && P) { cat = chip.getAttribute('data-cat'); document.querySelectorAll('.pp-chip').forEach(function (c) { var on = c.getAttribute('data-cat') === cat; c.classList.toggle('on', on); c.setAttribute('aria-selected', on); }); drawGrid(); return; }
    var tile = t.closest('.pp-tile'); if (tile) { openLb(Number(tile.getAttribute('data-i')) || 0); return; }
    if (t.closest('[data-lb-close]') || t === lb) { closeLb(); return; }
    if (t.closest('[data-lb-prev]')) { openLb(lbIndex - 1); return; }
    if (t.closest('[data-lb-next]')) { openLb(lbIndex + 1); return; }
    if (t.classList.contains('pp-lb-stage')) closeLb();
  });
  document.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('show')) return;
    if (e.key === 'Escape') closeLb(); else if (e.key === 'ArrowLeft') openLb(lbIndex - 1); else if (e.key === 'ArrowRight') openLb(lbIndex + 1);
    else if (e.key === 'Tab') { var f = lb.querySelectorAll('button,a[href]'); if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  });
  var sx = 0, sy = 0;
  lb.addEventListener('touchstart', function (e) { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
  lb.addEventListener('touchend', function (e) { var t = e.changedTouches[0]; if (!t) return; var dx = t.clientX - sx, dy = t.clientY - sy; if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) openLb(lbIndex + (dx < 0 ? 1 : -1)); }, { passive: true });

  // ---------- start ----------
  function start() {
    var slug = slugFromUrl();
    if (!BASE || !KEY) { gone('Portfolio unavailable', 'This page is not set up yet. Please try again later.'); return; }
    if (!slug) { gone('Portfolio not found', 'This link looks incomplete. Please ask the tailor to send the link again.'); return; }
    load(slug).then(function (p) {
      if (!p) { gone('Portfolio not found', 'This portfolio is not available. The tailor may have changed or turned off the link.'); return; }
      P = p; cat = 'All'; render(); track(slug);
    }).catch(function () { gone('Internet failed', 'Please check your connection and try again.', true); });
  }
  start();
})();
