/* SEWZA public tailor portfolio. Reads one published portfolio from Supabase (read-only, no login).
   Premium fashion-website edition: hero, slideshow, services, customer reviews, FAQ, floating WhatsApp chat. */
(function () {
  'use strict';
  var cfg = window.SEWZA_SUPABASE_CONFIG || {};
  var BASE = String(cfg.url || '').replace(/\/$/, '');
  var KEY = cfg.anonKey || '';
  var MEDIA = BASE + '/storage/v1/object/public/portfolio-media/';
  var app = document.getElementById('app');
  var lb = document.getElementById('ppLightbox');
  var toastEl = document.getElementById('ppToast');
  var modal = document.getElementById('ppModal');
  var P = null;            // the portfolio being shown
  var S = null;            // its page settings (colours, hero, services ...)
  var R = { state: 'loading', items: [], avg: 0, count: 0, dist: [0, 0, 0, 0, 0] };   // customer reviews
  var shown = [];          // works currently visible (after the category filter)
  var cat = 'All';
  var gridLimit = 12;
  var lbList = [], lbIndex = 0, lastFocus = null, toastTimer = null, modalFocus = null;
  var slideList = [], sl = null;
  var lockCount = 0;
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- colour palettes + type styles (ids must match the editor in app.js) ----------
  var THEMES = {
    emerald:    { night: '#04382b', deep: '#064e3b', mid: '#0f766e', gold: '#d4af37', gold2: '#ecd27a', goldDeep: '#8b6f47', ivory: '#fbf8f1', cream: '#f4eee0', ink: '#10261f', muted: '#5f716a' },
    royal:      { night: '#091633', deep: '#11285c', mid: '#2349a8', gold: '#d4af37', gold2: '#ecd27a', goldDeep: '#8b6f47', ivory: '#f8f9fd', cream: '#edf0f8', ink: '#0e1a36', muted: '#5b6680' },
    rose:       { night: '#4a1830', deep: '#86254f', mid: '#bf3f6e', gold: '#d99a85', gold2: '#f3c9b9', goldDeep: '#a5624f', ivory: '#fff8f6', cream: '#fbebe6', ink: '#3a1424', muted: '#7d6169' },
    plum:       { night: '#24093f', deep: '#46198a', mid: '#6d34c4', gold: '#e0b84a', gold2: '#f2d98a', goldDeep: '#957a24', ivory: '#fbf8ff', cream: '#f1eafa', ink: '#231040', muted: '#6b6180' },
    noir:       { night: '#09090b', deep: '#16161a', mid: '#2e2e38', gold: '#c9a227', gold2: '#e6c967', goldDeep: '#8a6d12', ivory: '#f7f5f0', cream: '#ece8dc', ink: '#141416', muted: '#66645e' },
    terracotta: { night: '#351405', deep: '#7a2c10', mid: '#b24f1f', gold: '#d6b58c', gold2: '#efd6b3', goldDeep: '#946f45', ivory: '#fff8f0', cream: '#f8eadb', ink: '#3a1c10', muted: '#7d6a5d' },
    burgundy:   { night: '#330814', deep: '#651225', mid: '#9a2438', gold: '#d4af37', gold2: '#ecd27a', goldDeep: '#8b6f47', ivory: '#fff9f4', cream: '#f7ebe4', ink: '#3a0f1a', muted: '#7a6469' },
    ocean:      { night: '#052a33', deep: '#0a4b5c', mid: '#0e7f92', gold: '#f0a58b', gold2: '#f9cdbc', goldDeep: '#b0654e', ivory: '#f6fbfc', cream: '#e6f2f4', ink: '#0c2a33', muted: '#587279' }
  };
  var FONTS = {
    classic: { family: '"Playfair Display",Georgia,serif', scale: 1 },
    luxe: { family: '"Cormorant Garamond","Playfair Display",Georgia,serif', scale: 1.12 },
    modern: { family: '"Syne","Manrope",system-ui,sans-serif', scale: .9 }
  };
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

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
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2800);
  }
  function lockScroll(on) {
    lockCount = Math.max(0, lockCount + (on ? 1 : -1));
    document.body.style.overflow = lockCount ? 'hidden' : '';
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
    r: '<path d="m9.500 5 7 7-7 7"/>',
    clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
    phone: '<path d="M6.500 4h3l1.500 4-2 1.500a11 11 0 0 0 5.500 5.500L16 13l4 1.500v3a2 2 0 0 1-2 2A14 14 0 0 1 4.500 6a2 2 0 0 1 2-2z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    down: '<path d="m6 9.500 6 6 6-6"/>',
    go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    play: '<path d="M8.500 5.500v13l10-6.500z"/>',
    pause: '<path d="M8.500 5v14M15.500 5v14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
    map: '<path d="m3.500 6.500 5.500-2 6 2.500 5.500-2v13l-5.500 2-6-2.500-5.500 2z"/><path d="M9 4.500v13M15 7v13"/>',
    scissors: '<circle cx="6.500" cy="6.500" r="2.500"/><circle cx="6.500" cy="17.500" r="2.500"/><path d="m8.500 8 11 8.500M8.500 16l11-8.500"/>',
    ruler: '<path d="m4 15.500 11.500-11.500 4.500 4.500L8.500 20z"/><path d="m8 11 2 2M11 8l2 2M5.500 14l1.500 1.500"/>',
    bag: '<path d="M5.500 8.500h13l1 11.500h-15z"/><path d="M9 8.500V7a3 3 0 0 1 6 0v1.500"/>'
  };
  function ic(n) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  var WA_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';
  function waIcon(cls) { return '<svg class="' + (cls || 'wa-ic') + '" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + WA_PATH + '"/></svg>'; }
  var STAR_D = 'M12 2.500l2.900 6.100 6.600.9-4.800 4.600 1.200 6.600L12 17.500l-5.900 3.200 1.200-6.600L2.500 9.500l6.600-.9z';
  function starRow() { var o = ''; for (var i = 0; i < 5; i++) o += '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + STAR_D + '"/></svg>'; return o; }
  function stars(avg, cls) {
    var pct = Math.max(0, Math.min(100, avg / 5 * 100));
    return '<span class="pp-stars ' + (cls || '') + '" role="img" aria-label="' + (Math.round(avg * 10) / 10) + ' out of 5 stars"><span class="pp-stars-b">' + starRow() + '</span><span class="pp-stars-f" style="width:' + pct + '%">' + starRow() + '</span></span>';
  }
  var SOCIALS = [['instagram', 'ig', 'Instagram'], ['tiktok', 'tt', 'TikTok'], ['facebook', 'fb', 'Facebook'], ['twitter', 'x', 'X (Twitter)'], ['youtube', 'yt', 'YouTube'], ['website', 'web', 'Website']];

  // ---------- data ----------
  function normSettings(raw) {
    var s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    var hero = obj(s.hero), sw = obj(s.slideshow), ch = obj(s.chat), sh = obj(s.show);
    return {
      theme: typeof s.theme === 'string' && has(THEMES, s.theme) ? s.theme : 'emerald',
      font: typeof s.font === 'string' && has(FONTS, s.font) ? s.font : 'classic',
      heroImage: media(hero.image),
      slideOn: sw.on !== false, slideAuto: sw.auto !== false,
      chatOn: ch.on !== false, chatMsg: str(ch.msg, 160), chatBubble: str(ch.bubble, 40),
      banner: str(s.banner, 140),
      services: (Array.isArray(s.services) ? s.services : []).map(function (x) { return x && typeof x === 'object' ? { name: str(x.name, 60), price: str(x.price, 30), desc: str(x.desc, 160) } : null; }).filter(function (x) { return x && x.name; }).slice(0, 10),
      faqs: (Array.isArray(s.faqs) ? s.faqs : []).map(function (x) { return x && typeof x === 'object' ? { q: str(x.q, 120), a: str(x.a, 400) } : null; }).filter(function (x) { return x && x.q && x.a; }).slice(0, 10),
      hours: str(s.hours, 200), mapUrl: link(s.mapUrl),
      showSteps: sh.steps !== false, showReviews: sh.reviews !== false
    };
  }
  function normalize(r) {
    var works = (Array.isArray(r.works) ? r.works : []).map(function (w) {
      return w && typeof w === 'object' ? { id: str(w.id, 60), url: media(w.url), title: str(w.title, 70), category: str(w.category, 40), caption: str(w.caption, 240), featured: w.featured === true } : null;
    }).filter(function (w) { return w && w.url; }).slice(0, 60);
    var soc = {}, src = r.socials && typeof r.socials === 'object' ? r.socials : {};
    SOCIALS.forEach(function (s) { var l = link(src[s[0]]); if (l) soc[s[0]] = l; });
    var wa = String(r.whatsapp || '').replace(/\D/g, '');
    return {
      uid: /^[0-9a-f-]{36}$/i.test(String(r.user_id || '')) ? String(r.user_id) : '',
      slug: str(r.slug, 40), name: str(r.business_name, 80) || 'Tailor', tagline: str(r.tagline, 120), about: str(r.about, 900),
      location: str(r.location, 100), wa: wa.length >= 8 && wa.length <= 15 ? wa : '', logo: media(r.logo_url),
      socials: soc, specialties: (Array.isArray(r.specialties) ? r.specialties : []).map(function (x) { return str(x, 40); }).filter(Boolean).slice(0, 10), works: works,
      settings: normSettings(r.settings)
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
  // Customer reviews: only approved ones are ever readable here (the database enforces it).
  function loadReviews() {
    if (!P.uid || !S.showReviews) { R.state = 'off'; return Promise.resolve(); }
    var url = BASE + '/rest/v1/portfolio_reviews?portfolio_user_id=eq.' + encodeURIComponent(P.uid) + '&status=eq.approved&select=id,reviewer_name,rating,comment,owner_reply,created_at&order=created_at.desc&limit=200';
    return fetchWithTimeout(url, { headers: { apikey: KEY, Accept: 'application/json' } }, 12000).then(function (res) {
      if (res.status === 404 || res.status === 400) { R.state = 'off'; return null; }     // reviews are not set up in Supabase yet
      if (!res.ok) throw new Error('status ' + res.status);
      return res.json();
    }).then(function (rows) {
      if (rows === null) return;
      var items = (Array.isArray(rows) ? rows : []).map(function (x) {
        var n = Math.round(Number(x && x.rating));
        if (!x || !(n >= 1 && n <= 5)) return null;
        return { id: str(x.id, 60), name: str(x.reviewer_name, 60) || 'Customer', rating: n, comment: str(x.comment, 600), reply: str(x.owner_reply, 400), date: str(x.created_at, 40) };
      }).filter(Boolean);
      var dist = [0, 0, 0, 0, 0], sum = 0;
      items.forEach(function (x) { dist[x.rating - 1]++; sum += x.rating; });
      R = { state: 'ok', items: items, count: items.length, avg: items.length ? Math.round(sum / items.length * 10) / 10 : 0, dist: dist };
    }).catch(function () { R.state = 'ok'; });
  }

  // ---------- whatsapp / share ----------
  function waUrl(text) { return P && P.wa ? 'https://wa.me/' + P.wa + '?text=' + encodeURIComponent(text) : ''; }
  function waGeneral() { return waUrl('Hello ' + P.name + ', I found your portfolio on SEWZA and I would like to place an order.'); }
  function waChat() { return waUrl(S.chatMsg || ('Hello ' + P.name + ', I found your portfolio on SEWZA and I would like to place an order.')); }
  function waDesign(w) { return waUrl('Hello ' + P.name + ', I saw ' + (w.title ? '"' + w.title + '"' : 'a design') + ' on your SEWZA portfolio and I would like something like it. Please let me know the price and how long it takes.'); }
  function waService(s) { return waUrl('Hello ' + P.name + ', I saw "' + s.name + '" on your SEWZA portfolio and I would like to know more. Please let me know the price and how long it takes.'); }
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
  function a(href, cls, inner, extra) { return '<a class="' + cls + '" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"' + (extra || '') + '>' + inner + '</a>'; }

  // ---------- theme ----------
  function applyTheme() {
    var t = THEMES[S.theme], f = FONTS[S.font], r = document.documentElement.style;
    r.setProperty('--green-night', t.night); r.setProperty('--green-deep', t.deep); r.setProperty('--green', t.mid);
    r.setProperty('--gold', t.gold); r.setProperty('--gold-2', t.gold2); r.setProperty('--gold-deep', t.goldDeep);
    r.setProperty('--ivory', t.ivory); r.setProperty('--cream', t.cream); r.setProperty('--ink', t.ink); r.setProperty('--muted', t.muted);
    r.setProperty('--serif', f.family); r.setProperty('--hs', String(f.scale));
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t.deep);
  }

  // ---------- render helpers ----------
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
  function logoHtml(cls) {
    var initial = esc((P.name.charAt(0) || 'S').toUpperCase());
    return P.logo ? '<img class="' + cls + '" src="' + esc(P.logo) + '" alt="' + esc(P.name) + ' logo" decoding="async">' : '<span class="' + cls + '">' + initial + '</span>';
  }
  function socialsHtml() {
    return SOCIALS.filter(function (s) { return P.socials[s[0]]; }).map(function (s) {
      return '<a class="pp-soc" href="' + esc(P.socials[s[0]]) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(s[2]) + '">' + ic(s[1]) + '</a>';
    }).join('');
  }
  function aboutImage() {
    if (S.heroImage) return S.heroImage;
    if (P.works.length > 1) return P.works[1].url;
    if (P.works.length) return P.works[0].url;
    return '';
  }
  function hasAbout() { return !!(P.about || P.specialties.length); }
  function featured() {
    if (P.works.length < 2) return [];
    var f = P.works.filter(function (w) { return w.featured; });
    return f.length >= 2 ? f.slice(0, 12) : P.works.slice(0, 8);
  }
  function fmtDate(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }); }
  function rvAttr(i) { return ' class="rv" style="--d:' + (i * 90) + 'ms"'; }

  // ---------- sections ----------
  function head() {
    var links = [];
    if (P.works.length) links.push(['work', 'Collection']);
    if (hasAbout()) links.push(['about', 'About']);
    if (S.services.length) links.push(['services', 'Services']);
    if (S.showReviews && R.state !== 'off') links.push(['reviews', 'Reviews']);
    if (S.faqs.length) links.push(['faq', 'FAQ']);
    links.push(['contact', 'Contact']);
    var nav = links.map(function (l) { return '<a href="#' + l[0] + '" data-nav="' + l[0] + '"' + (l[0] === 'reviews' ? ' data-needs-reviews' : '') + '>' + l[1] + '</a>'; }).join('');
    var order = P.wa ? a(waGeneral(), 'pp-btn gold sm pp-nav-order', waIcon('wa-ic') + 'Order') : '';
    return '<div class="pp-head" id="ppHead">' +
      (S.banner ? '<div class="pp-banner" id="ppBanner"><span>' + ic('spark') + esc(S.banner) + '</span></div>' : '') +
      '<nav class="pp-nav" aria-label="Main"><div class="pp-wrap pp-nav-in">' +
      '<a class="pp-nav-brand" href="#top" aria-label="' + esc(P.name) + ' — back to top">' + logoHtml('pp-nav-logo') + '<span>' + esc(P.name) + '</span></a>' +
      '<div class="pp-nav-links">' + nav + '</div>' +
      '<div class="pp-nav-actions"><button class="pp-icon-btn" type="button" data-share aria-label="Share this portfolio">' + ic('share') + '</button>' + order +
      '<button class="pp-icon-btn pp-burger" type="button" id="ppBurger" aria-label="Open menu" aria-expanded="false" aria-controls="ppDrawer">' + ic('menu') + '</button></div>' +
      '</div></nav>' +
      '<div class="pp-drawer" id="ppDrawer"><div class="pp-drawer-in">' + nav + (P.wa ? a(waGeneral(), 'pp-btn gold', waIcon('wa-ic') + 'Order on WhatsApp') : '') + '</div></div></div>';
  }
  function hero() {
    var initial = esc((P.name.charAt(0) || 'S').toUpperCase());
    var bgSrc = S.heroImage || (P.works[0] && P.works[0].url) || '';
    var bg = bgSrc ? '<img class="pp-hero-img' + (S.heroImage ? '' : ' ambient') + '" src="' + esc(bgSrc) + '" alt="" decoding="async" fetchpriority="high">' : '';
    var meta = (P.location ? '<span class="pp-pill">' + ic('pin') + esc(P.location) + '</span>' : '') +
      (P.works.length ? '<span class="pp-pill gold">' + ic('spark') + P.works.length + (P.works.length === 1 ? ' design' : ' designs') + '</span>' : '');
    var specs = P.specialties.slice(0, 4).map(function (s) { return '<span class="pp-pill">' + esc(s) + '</span>'; }).join('');
    var cta = (P.wa ? a(waGeneral(), 'pp-btn gold', waIcon('wa-ic') + 'Order on WhatsApp') : '') +
      (P.works.length ? '<a class="pp-btn ghost" href="#work">View collection' + ic('down') + '</a>' : '<button class="pp-btn ghost" type="button" data-share>' + ic('share') + 'Share</button>');
    var c = P.works.slice(0, 3), collage;
    if (c.length >= 2) collage = '<div class="pp-collage" aria-hidden="true">' + c.map(function (w, i) { return '<div class="pp-card c' + (i + 1) + '"><img src="' + esc(w.url) + '" alt="" loading="eager" decoding="async"></div>'; }).join('') + '</div>';
    else if (c.length === 1) collage = '<div class="pp-collage" aria-hidden="true"><div class="pp-card only"><img src="' + esc(c[0].url) + '" alt="" decoding="async"></div></div>';
    else collage = '<div class="pp-art" aria-hidden="true">' + initial + '</div>';
    var dust = ''; for (var i = 0; i < 9; i++) dust += '<i style="--x:' + (6 + i * 11) + '%;--s:' + (3 + (i * 7) % 5) + 'px;--t:' + (9 + (i * 5) % 9) + 's;--dl:' + (-(i * 2.3)) + 's"></i>';
    return '<header class="pp-hero" id="top"><div class="pp-hero-bg" id="ppHeroBg" aria-hidden="true">' + bg + '<div class="pp-hero-shade"></div><div class="pp-dust">' + dust + '</div></div>' +
      '<div class="pp-wrap pp-hero-inner"><div class="pp-id"><div class="pp-logo">' + logoHtml('pp-logo-i') + '</div><p class="pp-kicker">Tailor &amp; fashion designer</p><h1 class="pp-name">' + esc(P.name) + '</h1>' +
      (P.tagline ? '<p class="pp-tag">' + esc(P.tagline) + '</p>' : '') +
      '<a class="pp-hero-rate" id="ppHeroRate" href="#reviews" hidden></a>' +
      '<div class="pp-meta">' + meta + specs + '</div><div class="pp-cta">' + cta + '</div>' + (socialsHtml() ? '<div class="pp-socials">' + socialsHtml() + '</div>' : '') + '</div>' + collage + '</div>' +
      '<a class="pp-scroll" href="#' + (P.works.length ? 'work' : 'contact') + '" aria-label="Scroll down"><i></i></a>' +
      '<div class="pp-wave" aria-hidden="true"><svg viewBox="0 0 1440 70" preserveAspectRatio="none"><path fill="currentColor" d="M0 40C240 80 480 0 720 24s480 52 720 8V70H0z"/></svg></div></header>';
  }
  function statsItems() {
    var items = [[P.works.length, P.works.length === 1 ? 'Design' : 'Designs', 0]];
    if (R.count) items.push([R.avg, 'Customer rating', 1]);
    items.push([P.specialties.length || '—', 'Specialties', 0]);
    items.push([P.location ? '<span class="pp-stat-loc">' + esc(P.location.split(',')[0]) + '</span>' : '—', 'Based in', -1]);
    return items;
  }
  function statsInner() {
    return statsItems().map(function (i) {
      var num = i[2] >= 0 && typeof i[0] === 'number' ? '<b data-count="' + i[0] + '" data-dec="' + i[2] + '">0</b>' : '<b>' + i[0] + '</b>';
      return '<div class="pp-stat">' + num + '<span>' + i[1] + '</span></div>';
    }).join('');
  }
  function stats() { return '<div class="pp-wrap"><div class="pp-stats" id="ppStats" style="--n:' + statsItems().length + '">' + statsInner() + '</div></div>'; }
  function marquee() {
    if (!P.specialties.length) return '';
    var seq = []; while (seq.length < 8) seq = seq.concat(P.specialties);
    var one = seq.map(function (s) { return '<span>' + esc(s) + '</span><i aria-hidden="true">✦</i>'; }).join('');
    return '<div class="pp-marquee" aria-hidden="true"><div class="pp-marquee-t">' + one + one + '</div></div>';
  }
  function slideshow() {
    slideList = S.slideOn ? featured() : [];
    if (!slideList.length) return '';
    var slides = slideList.map(function (w, i) {
      return '<figure class="pp-sl" data-i="' + i + '"><img src="' + esc(w.url) + '" alt="' + esc(w.title || (P.name + ' design ' + (i + 1))) + '" ' + (i < 3 ? 'loading="eager"' : 'loading="lazy"') + ' decoding="async" draggable="false"></figure>';
    }).join('');
    return '<section class="pp-show" id="featured" aria-label="Featured designs"><div class="pp-show-bg" aria-hidden="true"></div><div class="pp-wrap pp-show-head rv"><p class="pp-eyebrow light">Featured work</p><h2 class="pp-h2">Latest creations</h2><p class="pp-sub">A closer look at recent outfits sewn for happy customers.</p></div>' +
      '<div class="pp-sl-stage" id="ppSl" tabindex="0" role="group" aria-roledescription="carousel" aria-label="Featured designs. Use the left and right arrow keys to change slide."><div class="pp-sl-track">' + slides + '</div>' +
      (slideList.length > 1 ? '<button class="pp-sl-nav prev" type="button" data-sl-prev aria-label="Previous design">' + ic('l') + '</button><button class="pp-sl-nav next" type="button" data-sl-next aria-label="Next design">' + ic('r') + '</button>' : '') + '</div>' +
      '<div class="pp-sl-info" id="ppSlInfo" aria-live="polite"></div>' +
      '<div class="pp-wrap pp-sl-ctrl"><span class="pp-sl-count" id="ppSlCount">01 / ' + (slideList.length < 10 ? '0' : '') + slideList.length + '</span><div class="pp-sl-prog" id="ppSlProg" aria-hidden="true"><i></i></div>' +
      (slideList.length > 1 ? '<button class="pp-sl-play" type="button" data-sl-play aria-label="Pause slideshow" id="ppSlPlay">' + ic('pause') + '</button>' : '') + '</div></section>';
  }
  function gallery() {
    var cats = categories();
    var filters = cats.length > 1 ? '<div class="pp-filters" role="tablist" aria-label="Filter designs">' + ['All'].concat(cats).map(function (c) {
      var n = c === 'All' ? P.works.length : P.works.filter(function (w) { return w.category === c; }).length;
      return '<button type="button" role="tab" class="pp-chip' + (c === cat ? ' on' : '') + '" data-cat="' + esc(c) + '" aria-selected="' + (c === cat) + '">' + esc(c) + '<small>' + n + '</small></button>';
    }).join('') + '</div>' : '';
    return '<section class="pp-section" id="work"><div class="pp-wrap"><div class="rv"><p class="pp-eyebrow">The collection</p><h2 class="pp-h2">Finished work you can order today</h2><p class="pp-sub">Tap any design to see it bigger, then message ' + esc(P.name) + ' to get yours made.</p></div>' + filters +
      (P.works.length ? '<div class="pp-grid" id="ppGrid"></div><div class="pp-more-wrap" id="ppMoreWrap"></div>' : '<div class="pp-empty"><b>New designs coming soon</b>This tailor is still adding photos. Message them on WhatsApp to see more of their work.</div>') + '</div></section>';
  }
  function about() {
    if (!hasAbout()) return '';
    var img = aboutImage();
    var visual = img ? '<div class="pp-about-vis rv"><div class="pp-arch"><img src="' + esc(img) + '" alt="" loading="lazy" decoding="async"></div><div class="pp-about-badge">' + logoHtml('pp-about-logo') + '<span>' + esc(P.name) + '</span></div></div>' : '';
    var specs = P.specialties.length ? '<p class="pp-mini">What we make best</p><ul class="pp-spec">' + P.specialties.map(function (x) { return '<li><i>' + ic('spark') + '</i><span>' + esc(x) + '</span></li>'; }).join('') + '</ul>' : '';
    var txt = '<div class="pp-about-txt rv" style="--d:120ms"><p class="pp-eyebrow">Our story</p><h2 class="pp-h2">Meet ' + esc(P.name) + '</h2>' + (P.about ? '<p class="pp-about-p">' + esc(P.about) + '</p>' : '') + specs +
      (P.wa ? '<div class="pp-cta left">' + a(waGeneral(), 'pp-btn dark', waIcon('wa-ic') + 'Start your order') + '</div>' : '') + '</div>';
    return '<section class="pp-section" id="about"><div class="pp-wrap"><div class="pp-about' + (visual ? '' : ' solo') + '">' + visual + txt + '</div></div></section>';
  }
  function services() {
    if (!S.services.length) return '';
    return '<section class="pp-section" id="services"><div class="pp-wrap"><div class="rv"><p class="pp-eyebrow">What we offer</p><h2 class="pp-h2">Services &amp; pricing</h2><p class="pp-sub">Clear starting prices so you know what to expect. Final price depends on fabric and style.</p></div><div class="pp-services">' +
      S.services.map(function (s, i) {
        return '<article' + rvAttr(i % 3) + '><div class="pp-svc"><span class="pp-svc-n">' + (i < 9 ? '0' : '') + (i + 1) + '</span><h3>' + esc(s.name) + '</h3>' + (s.desc ? '<p>' + esc(s.desc) + '</p>' : '') +
          '<div class="pp-svc-foot">' + (s.price ? '<span class="pp-price"><small>From</small>' + esc(s.price) + '</span>' : '<span></span>') + (P.wa ? a(waService(s), 'pp-svc-go', 'Enquire' + ic('go'), ' aria-label="Enquire about ' + esc(s.name) + ' on WhatsApp"') : '') + '</div></div></article>';
      }).join('') + '</div></div></section>';
  }
  function steps() {
    if (!S.showSteps) return '';
    return '<section class="pp-section"><div class="pp-wrap"><div class="rv"><p class="pp-eyebrow">Simple &amp; stress-free</p><h2 class="pp-h2">How to order</h2></div><div class="pp-steps">' +
      '<div' + rvAttr(0) + '><div class="pp-step"><b>Choose your style</b><p>Pick a design you love from the collection, or describe your own idea.</p></div></div>' +
      '<div' + rvAttr(1) + '><div class="pp-step"><b>Get measured</b><p>Your measurements are saved safely in a digital book, so every fitting is accurate.</p></div></div>' +
      '<div' + rvAttr(2) + '><div class="pp-step"><b>Collect on time</b><p>Agree a delivery date and get your outfit ready for the big day.</p></div></div></div></div></section>';
  }
  function reviewCard(x, i) {
    var reply = x.reply ? '<div class="pp-rv-reply"><b>Reply from ' + esc(P.name) + '</b><p>' + esc(x.reply) + '</p></div>' : '';
    return '<article class="pp-rv-card rv" style="--d:' + ((i % 3) * 90) + 'ms">' + stars(x.rating, 'sm') + '<p class="pp-rv-text">' + (x.comment ? esc(x.comment) : 'Great experience.') + '</p>' + reply +
      '<div class="pp-rv-by"><span class="pp-av" aria-hidden="true">' + esc(x.name.charAt(0).toUpperCase()) + '</span><span><b>' + esc(x.name) + '</b><small>' + esc(fmtDate(x.date)) + '</small></span></div></article>';
  }
  function reviewsInner() {
    var write = '<button class="pp-btn ' + (R.count ? 'dark' : 'gold') + '" type="button" data-rv-open>' + ic('spark') + (R.count ? 'Write a review' : 'Be the first to review') + '</button>';
    if (R.state === 'loading') return '<div class="pp-rv-skel"><i class="pp-skel"></i><i class="pp-skel"></i><i class="pp-skel"></i></div>';
    if (!R.count) return '<div class="pp-empty pp-rv-empty"><div class="pp-empty-stars">' + stars(0) + '</div><b>No reviews yet</b>Have you ordered from ' + esc(P.name) + '? Share your experience and help other customers choose with confidence.<div class="pp-cta" style="margin-top:18px">' + write + '</div></div>';
    var max = Math.max.apply(null, R.dist.concat([1]));
    var bars = [5, 4, 3, 2, 1].map(function (n) {
      var c = R.dist[n - 1];
      return '<div class="pp-bar"><span>' + n + '</span><div><i style="--w:' + Math.round(c / max * 100) + '%"></i></div><em>' + c + '</em></div>';
    }).join('');
    var list = R.items.slice(0, 6).map(reviewCard).join('');
    var rest = R.items.slice(6);
    return '<div class="pp-rv-wrap"><aside class="pp-rv-sum rv"><div class="pp-rv-big">' + R.avg.toFixed(1) + '</div>' + stars(R.avg, 'lg') + '<p>' + R.count + (R.count === 1 ? ' customer review' : ' customer reviews') + '</p><div class="pp-bars">' + bars + '</div>' + write + '</aside>' +
      '<div class="pp-rv-list" id="ppRvList">' + list + '</div></div>' +
      (rest.length ? '<div class="pp-more-wrap"><button class="pp-btn outline" type="button" data-rv-more>Show ' + rest.length + ' more review' + (rest.length === 1 ? '' : 's') + '</button></div>' : '') +
      '<p class="pp-fine center">Reviews are written by customers only. ' + esc(P.name) + ' can reply, but can never write or change a review.</p>';
  }
  function reviewsSection() {
    if (!S.showReviews || R.state === 'off') return '';
    return '<section class="pp-section pp-reviews" id="reviews" data-needs-reviews><div class="pp-wrap"><div class="rv"><p class="pp-eyebrow">Kind words</p><h2 class="pp-h2">What customers say</h2></div><div id="ppRvMount">' + reviewsInner() + '</div></div></section>';
  }
  function faq() {
    if (!S.faqs.length) return '';
    return '<section class="pp-section" id="faq"><div class="pp-wrap pp-faq-wrap"><div class="rv"><p class="pp-eyebrow">Good to know</p><h2 class="pp-h2">Questions, answered</h2><p class="pp-sub">Cannot find what you need? Send a message and we will gladly help.</p></div><div class="pp-faq">' +
      S.faqs.map(function (f, i) {
        return '<div class="pp-faq-i rv" style="--d:' + ((i % 4) * 70) + 'ms"><button class="pp-faq-q" type="button" aria-expanded="false" aria-controls="ppFaq' + i + '" data-faq><span>' + esc(f.q) + '</span><i aria-hidden="true"></i></button><div class="pp-faq-a" id="ppFaq' + i + '" role="region"><div><p>' + esc(f.a) + '</p></div></div></div>';
      }).join('') + '</div></div></section>';
  }
  function mapLink() { return S.mapUrl || (P.location ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(P.name + ' ' + P.location) : ''); }
  function contact() {
    var cards = '';
    if (P.location) cards += '<div class="pp-info"><i>' + ic('pin') + '</i><b>Visit us</b><p>' + esc(P.location) + '</p>' + (mapLink() ? a(mapLink(), 'pp-info-link', 'Get directions' + ic('go')) : '') + '</div>';
    if (S.hours) cards += '<div class="pp-info"><i>' + ic('clock') + '</i><b>Opening hours</b><p class="pre">' + esc(S.hours) + '</p></div>';
    if (P.wa) cards += '<div class="pp-info"><i>' + ic('phone') + '</i><b>WhatsApp</b><p>+' + esc(P.wa) + '</p>' + a(waGeneral(), 'pp-info-link', 'Send a message' + ic('go')) + '</div>';
    return '<section class="pp-section pp-contact" id="contact"><div class="pp-wrap"><section class="pp-band rv"><h2>Ready for your next outfit?</h2><p>Send ' + esc(P.name) + ' a message and get a quote for the design you want.</p>' +
      (P.location ? '<div class="pp-addr">' + ic('pin') + esc(P.location) + '</div>' : '') +
      '<div class="pp-cta">' + (P.wa ? a(waGeneral(), 'pp-btn gold', waIcon('wa-ic') + 'Chat on WhatsApp') : '') + '<button class="pp-btn ghost" type="button" data-share>' + ic('share') + 'Share this page</button></div>' +
      (socialsHtml() ? '<div class="pp-socials" style="justify-content:center">' + socialsHtml() + '</div>' : '') + '</section>' +
      (cards ? '<div class="pp-infos">' + cards + '</div>' : '') + '</div></section>';
  }
  function footer() {
    return '<footer class="pp-foot"><div class="pp-wrap"><a class="pp-brand" href="index.html"><img src="icon-192.png" alt="">SEWZA</a><p>The digital measurement book for modern tailors.</p><p style="margin-top:6px">Are you a tailor? <a href="index.html">Create your own portfolio on SEWZA</a></p></div></footer>';
  }
  function chatFloat() {
    if (!P.wa || !S.chatOn) return '';
    return '<div class="pp-wa" id="ppWa"><div class="pp-wa-bubble" id="ppWaBubble" role="note"><span>' + esc(S.chatBubble || 'Hi 👋 Chat with us on WhatsApp') + '</span><button type="button" data-wa-close aria-label="Dismiss">' + ic('x2') + '</button></div>' +
      a(waChat(), 'pp-wa-btn', '<span class="pp-wa-ring"></span><span class="pp-wa-ring r2"></span>' + waIcon('wa-main') + '<span class="pp-wa-dot" aria-hidden="true"></span>', ' aria-label="Chat with ' + esc(P.name) + ' on WhatsApp"') + '</div>';
  }
  function dock() {
    if (P.wa && S.chatOn) return '';
    return '<div class="pp-dock">' + (P.wa ? a(waGeneral(), 'pp-btn gold', ic('chat') + 'Order on WhatsApp') : '') +
      '<button class="pp-share" type="button" data-share aria-label="Share this portfolio">' + ic('share') + '</button></div>';
  }
  function reviewModalHtml() {
    var picks = [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="pp-pick" role="radio" aria-checked="false" aria-label="' + n + (n === 1 ? ' star' : ' stars') + '" data-v="' + n + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + STAR_D + '"/></svg></button>'; }).join('');
    return '<div class="pp-mbox" role="dialog" aria-modal="true" aria-labelledby="ppRvT"><button class="pp-mx" type="button" data-modal-close aria-label="Close">' + ic('x2') + '</button>' +
      '<div id="ppRvFormWrap"><p class="pp-eyebrow">Your experience</p><h3 id="ppRvT">Rate ' + esc(P.name) + '</h3><p class="pp-sub sm">Only customers can leave a review. It will show on this page after ' + esc(P.name) + ' approves it.</p>' +
      '<form id="ppRvForm" novalidate><div class="pp-pickrow"><span id="ppPickL">Your rating</span><div class="pp-picks" role="radiogroup" aria-labelledby="ppPickL" id="ppPicks">' + picks + '</div><b id="ppPickT" class="pp-pick-t"></b></div>' +
      '<label>Your name<input id="ppRvName" type="text" maxlength="60" autocomplete="name" placeholder="e.g. Ada Okafor"></label>' +
      '<label>Your review<textarea id="ppRvText" rows="5" maxlength="600" placeholder="What did you order? How was the fit and the service?"></textarea><small id="ppRvCount">0 / 600 (at least 10 letters)</small></label>' +
      '<input class="pp-hp" type="text" name="website" id="ppRvHp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<p class="pp-form-msg" id="ppRvMsg" role="alert"></p><button class="pp-btn gold full" type="submit" id="ppRvSend">Send my review</button></form></div>' +
      '<div class="pp-thanks" id="ppRvThanks" hidden><div class="pp-tick">' + ic('check') + '</div><h3>Thank you!</h3><p id="ppRvThanksP"></p><button class="pp-btn dark" type="button" data-modal-close>Done</button></div></div>';
  }

  function setMeta() {
    document.title = P.name + ' — Tailor Portfolio | SEWZA';
    var d = (P.tagline || ('Finished clothes by ' + P.name + (P.location ? ' in ' + P.location : '') + '. Order on WhatsApp.')).slice(0, 155);
    [['meta[name="description"]', d], ['meta[property="og:title"]', document.title], ['meta[property="og:description"]', d]].forEach(function (x) { var m = document.querySelector(x[0]); if (m) m.setAttribute('content', x[1]); });
  }
  function ldJson() {
    try {
      var o = { '@context': 'https://schema.org', '@type': 'ClothingStore', name: P.name, url: location.href.split('#')[0] };
      var d = P.tagline || P.about.slice(0, 200); if (d) o.description = d;
      var im = S.heroImage || (P.works[0] && P.works[0].url) || P.logo; if (im) o.image = im;
      if (P.location) o.address = { '@type': 'PostalAddress', streetAddress: P.location };
      if (P.wa) o.telephone = '+' + P.wa;
      var same = Object.keys(P.socials).map(function (k) { return P.socials[k]; }); if (same.length) o.sameAs = same;
      if (R.count) o.aggregateRating = { '@type': 'AggregateRating', ratingValue: R.avg, reviewCount: R.count, bestRating: 5, worstRating: 1 };
      var el = document.getElementById('ppLd');
      if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'ppLd'; document.head.appendChild(el); }
      el.textContent = JSON.stringify(o).replace(/</g, '\\u003c');
    } catch (e) {}
  }
  function render() {
    applyTheme(); setMeta();
    var needDock = !(P.wa && S.chatOn);
    document.body.classList.toggle('has-dock', needDock);
    app.innerHTML = head() + hero() + stats() + marquee() + slideshow() + gallery() + about() + services() + steps() + reviewsSection() + faq() + contact() + footer() + chatFloat() + dock();
    modal.innerHTML = reviewModalHtml();
    drawGrid(); slInit(); initReveal(); initChat(); updateHeroRate(); ldJson(); onScroll();
  }
  function updateHeroRate() {
    var el = document.getElementById('ppHeroRate'); if (!el) return;
    if (R.count) { el.hidden = false; el.innerHTML = stars(R.avg, 'sm') + '<b>' + R.avg.toFixed(1) + '</b><span>(' + R.count + (R.count === 1 ? ' review' : ' reviews') + ')</span>'; }
    else el.hidden = true;
  }
  function refreshReviews() {
    if (R.state === 'off') {
      [].forEach.call(document.querySelectorAll('[data-needs-reviews]'), function (n) { n.parentNode.removeChild(n); });
      return;
    }
    var mount = document.getElementById('ppRvMount'); if (mount) { mount.innerHTML = reviewsInner(); observeReveal(mount); }
    var st = document.getElementById('ppStats'); if (st) { st.style.setProperty('--n', statsItems().length); st.innerHTML = statsInner(); observeReveal(st); }
    updateHeroRate(); ldJson();
  }

  // ---------- gallery grid ----------
  var io = null;
  function drawGrid() {
    var grid = document.getElementById('ppGrid'); if (!grid) return;
    shown = cat === 'All' ? P.works : P.works.filter(function (w) { return w.category === cat; });
    var vis = shown.slice(0, gridLimit);
    grid.innerHTML = vis.map(function (w, i) {
      return '<button type="button" class="pp-tile" data-i="' + i + '" aria-label="Open ' + esc(w.title || 'design ' + (i + 1)) + '"><img src="' + esc(w.url) + '" alt="' + esc(w.title || (P.name + ' design ' + (i + 1))) + '" loading="lazy" decoding="async">' +
        ((w.title || w.category) ? '<span class="pp-tcap">' + (w.category ? '<span>' + esc(w.category) + '</span>' : '') + (w.title ? '<b>' + esc(w.title) + '</b>' : '') + '</span>' : '') + '<span class="pp-tzoom" aria-hidden="true">' + ic('plus') + '</span></button>';
    }).join('');
    var mw = document.getElementById('ppMoreWrap');
    if (mw) mw.innerHTML = shown.length > vis.length ? '<button class="pp-btn outline" type="button" data-more>Show ' + Math.min(12, shown.length - vis.length) + ' more designs <small>(' + (shown.length - vis.length) + ' left)</small></button>' : '';
    if (io) io.disconnect();
    var tiles = grid.querySelectorAll('.pp-tile');
    [].forEach.call(tiles, function (t) {
      var im = t.querySelector('img'), done = function () { t.classList.add('loaded'); };
      if (im.complete) done(); else { im.addEventListener('load', done); im.addEventListener('error', done); }
    });
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -6% 0px', threshold: .05 });
      [].forEach.call(tiles, function (t, i) { t.style.transitionDelay = Math.min(i % 6, 5) * 60 + 'ms'; io.observe(t); });
    } else [].forEach.call(tiles, function (t) { t.classList.add('in'); });
    // Safety net: never leave a design hidden if the scroll observer is slow or unsupported.
    setTimeout(function () { [].forEach.call(tiles, function (t) { t.classList.add('in'); }); }, 2500);
  }

  // ---------- scroll reveal, counters ----------
  var rvIo = null;
  function countUp(el) {
    var end = Number(el.getAttribute('data-count')) || 0, dec = Number(el.getAttribute('data-dec')) || 0;
    if (REDUCED || end === 0) { el.textContent = end.toFixed(dec); return; }
    var t0 = null, dur = 1300;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (end * e).toFixed(dec);
      if (p < 1) requestAnimationFrame(step); else el.textContent = end.toFixed(dec);
    }
    requestAnimationFrame(step);
  }
  function reveal(el) {
    el.classList.add('in');
    if (el.hasAttribute && el.hasAttribute('data-count')) countUp(el);
  }
  function observeReveal(root) {
    var els = [].slice.call(root.querySelectorAll('.rv:not(.in), [data-count]'));
    if (root.classList && (root.classList.contains('rv') || root.hasAttribute('data-count')) && !root.classList.contains('in')) els.push(root);
    if (!('IntersectionObserver' in window)) { els.forEach(reveal); return; }
    if (!rvIo) rvIo = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { rvIo.unobserve(e.target); if (e.target.hasAttribute('data-count') && !e.target.classList.contains('rv')) countUp(e.target); else reveal(e.target); } }); }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    els.forEach(function (el) { rvIo.observe(el); });
  }
  function initReveal() { if (rvIo) { rvIo.disconnect(); rvIo = null; } observeReveal(app); }

  // ---------- nav, parallax ----------
  var tick = false;
  function onScroll() {
    if (tick) return; tick = true;
    requestAnimationFrame(function () {
      tick = false;
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      var h = document.getElementById('ppHead'); if (h) h.classList.toggle('scrolled', y > 40);
      var bgEl = document.getElementById('ppHeroBg');
      if (bgEl && !REDUCED && y < window.innerHeight * 1.3) bgEl.style.setProperty('--py', Math.round(y * .22) + 'px');
      var cur = '', ids = ['work', 'about', 'services', 'reviews', 'faq', 'contact'];
      ids.forEach(function (id) { var s = document.getElementById(id); if (s && s.getBoundingClientRect().top < window.innerHeight * .4) cur = id; });
      [].forEach.call(document.querySelectorAll('[data-nav]'), function (l) { l.classList.toggle('on', l.getAttribute('data-nav') === cur); });
    });
  }
  function setDrawer(on) {
    var d = document.getElementById('ppDrawer'), b = document.getElementById('ppBurger'), hd = document.getElementById('ppHead'); if (!d || !b) return;
    d.classList.toggle('open', on); b.setAttribute('aria-expanded', on ? 'true' : 'false'); b.setAttribute('aria-label', on ? 'Close menu' : 'Open menu');
    b.innerHTML = ic(on ? 'x2' : 'menu'); if (hd) hd.classList.toggle('menu-open', on);
  }

  // ---------- floating WhatsApp button ----------
  var chatTimers = [];
  function initChat() {
    chatTimers.forEach(clearTimeout); chatTimers = [];
    var wa = document.getElementById('ppWa'); if (!wa) return;
    var dismissed = false; try { dismissed = sessionStorage.getItem('sewza_pf_bub') === '1'; } catch (e) {}
    chatTimers.push(setTimeout(function () { wa.classList.add('show'); }, 900));
    if (dismissed) return;
    function pop() { if (!document.body.contains(wa) || wa.classList.contains('quiet')) return; wa.classList.add('talk'); chatTimers.push(setTimeout(function () { wa.classList.remove('talk'); }, 6500)); }
    chatTimers.push(setTimeout(pop, 3600));
    chatTimers.push(setTimeout(pop, 32000));
  }
  function closeBubble() {
    var wa = document.getElementById('ppWa'); if (!wa) return;
    wa.classList.remove('talk'); wa.classList.add('quiet');
    try { sessionStorage.setItem('sewza_pf_bub', '1'); } catch (e) {}
  }

  // ---------- featured slideshow ----------
  function slInit() {
    if (sl && sl.timer) clearTimeout(sl.timer);
    var stage = document.getElementById('ppSl'); if (!stage) { sl = null; return; }
    sl = { stage: stage, slides: [].slice.call(stage.querySelectorAll('.pp-sl')), i: 0, n: slideList.length, W: 0, auto: S.slideAuto && !REDUCED && slideList.length > 1, hover: false, inView: false, userPaused: false, timer: null, drag: null, moved: false, ivl: 5600 };
    slPlace(); slInfo(false);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { es.forEach(function (e) { sl.inView = e.isIntersecting; slSchedule(); }); }, { threshold: .35 }).observe(stage); else sl.inView = true;
    stage.addEventListener('mouseenter', function () { sl.hover = true; slSchedule(); });
    stage.addEventListener('mouseleave', function () { sl.hover = false; slSchedule(); });
    stage.addEventListener('focusin', function () { sl.hover = true; slSchedule(); });
    stage.addEventListener('focusout', function () { sl.hover = false; slSchedule(); });
    stage.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') { e.preventDefault(); slGo(sl.i - 1, true); } else if (e.key === 'ArrowRight') { e.preventDefault(); slGo(sl.i + 1, true); } });
    stage.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('button')) return; sl.drag = { x: e.clientX, y: e.clientY }; sl.moved = false; });
    stage.addEventListener('pointermove', function (e) { if (sl.drag && Math.abs(e.clientX - sl.drag.x) > 12) sl.moved = true; });
    function end(e) {
      if (!sl.drag) return; var dx = e.clientX - sl.drag.x, dy = e.clientY - sl.drag.y; sl.drag = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) { slGo(sl.i + (dx < 0 ? 1 : -1), true); sl.moved = true; setTimeout(function () { sl.moved = false; }, 60); }
    }
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', function () { sl.drag = null; });
    stage.addEventListener('click', function (e) {
      var f = e.target.closest ? e.target.closest('.pp-sl') : null; if (!f || sl.moved) return;
      var idx = Number(f.getAttribute('data-i')) || 0;
      if (idx === sl.i) openLb(idx, slideList); else slGo(idx, true);
    });
  }
  function slOff(i) {
    var n = sl.n, d = i - sl.i;
    if (n >= 3) { var half = Math.floor(n / 2); d = ((i - sl.i + n + half) % n) - half; if (n % 2 === 0 && d === -half) d = half; }
    return d;
  }
  function slPlace() {
    if (!sl) return;
    var W = sl.slides[0] ? sl.slides[0].offsetWidth : 300, SW = sl.stage.clientWidth || 360, f1 = SW < 640 ? .92 : .8, f2 = f1 + (SW < 640 ? .34 : .4);
    sl.W = W;
    sl.slides.forEach(function (el, i) {
      var d = slOff(i), ad = Math.abs(d), x, sc, op, rot;
      if (ad === 0) { x = 0; sc = 1; op = 1; rot = 0; }
      else if (ad === 1) { x = (d < 0 ? -1 : 1) * f1 * W; sc = .84; op = .9; rot = d < 0 ? 10 : -10; }
      else if (ad === 2) { x = (d < 0 ? -1 : 1) * f2 * W; sc = .7; op = SW < 640 ? 0 : .55; rot = d < 0 ? 16 : -16; }
      else { x = (d < 0 ? -1 : 1) * f2 * W; sc = .6; op = 0; rot = 0; }
      el.style.transform = 'translate3d(' + Math.round(x) + 'px,0,0) scale(' + sc + ') rotateY(' + rot + 'deg)';
      el.style.opacity = op; el.style.zIndex = 10 - ad;
      el.classList.toggle('on', ad === 0); el.classList.toggle('side', ad !== 0);
      el.setAttribute('aria-hidden', ad === 0 ? 'false' : 'true');
      el.style.pointerEvents = ad > 2 || (ad === 2 && SW < 640) ? 'none' : 'auto';
    });
  }
  function slInfo(anim) {
    var el = document.getElementById('ppSlInfo'), w = slideList[sl.i]; if (!el || !w) return;
    var wa = P.wa ? a(waDesign(w), 'pp-btn gold sm', waIcon('wa-ic') + 'Ask about this design') : '';
    el.innerHTML = '<div class="pp-sl-cap' + (anim ? ' swap' : '') + '">' + (w.category ? '<small>' + esc(w.category) + '</small>' : '') + (w.title ? '<h3>' + esc(w.title) + '</h3>' : '') + (w.caption ? '<p>' + esc(w.caption) + '</p>' : '') + '<div class="pp-cta">' + wa + '<button class="pp-btn ghost sm" type="button" data-sl-view>View larger</button></div></div>';
    var c = document.getElementById('ppSlCount'); if (c) c.textContent = (sl.i < 9 ? '0' : '') + (sl.i + 1) + ' / ' + (sl.n < 10 ? '0' : '') + sl.n;
  }
  function slGo(n, user) {
    if (!sl) return; sl.i = ((n % sl.n) + sl.n) % sl.n; slPlace(); slInfo(true); slSchedule(true);
  }
  function slSchedule(restart) {
    if (!sl) return;
    if (sl.timer) { clearTimeout(sl.timer); sl.timer = null; }
    var prog = document.getElementById('ppSlProg'), play = document.getElementById('ppSlPlay');
    var run = sl.auto && !sl.userPaused && !sl.hover && sl.inView && !document.hidden;
    if (prog) { prog.classList.remove('run'); if (run) { void prog.offsetWidth; prog.style.setProperty('--ivl', sl.ivl + 'ms'); prog.classList.add('run'); } }
    if (play) { var playing = sl.auto && !sl.userPaused; play.innerHTML = ic(playing ? 'pause' : 'play'); play.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Play slideshow'); }
    if (run) sl.timer = setTimeout(function () { slGo(sl.i + 1, false); }, sl.ivl);
  }

  // ---------- lightbox ----------
  function openLb(i, list) {
    list = list || shown; lbList = list;
    if (!lbList.length) return;
    lbIndex = (i + lbList.length) % lbList.length;
    var w = lbList[lbIndex]; var was = lb.classList.contains('show'); if (!was) lastFocus = document.activeElement;
    var wa = P.wa ? '<a class="pp-btn gold" href="' + esc(waDesign(w)) + '" target="_blank" rel="noopener noreferrer">' + waIcon('wa-ic') + 'Ask about this design</a>' : '';
    lb.innerHTML = '<div class="pp-lb-bar"><span>' + (lbIndex + 1) + ' / ' + lbList.length + '</span><button class="pp-lb-x" type="button" data-lb-close aria-label="Close">' + ic('x2') + '</button></div>' +
      '<div class="pp-lb-stage">' + (lbList.length > 1 ? '<button class="pp-lb-nav prev" type="button" data-lb-prev aria-label="Previous design">' + ic('l') + '</button><button class="pp-lb-nav next" type="button" data-lb-next aria-label="Next design">' + ic('r') + '</button>' : '') +
      '<img src="' + esc(w.url) + '" alt="' + esc(w.title || 'Design') + '"></div>' +
      '<div class="pp-lb-info">' + (w.category ? '<small>' + esc(w.category) + '</small>' : '') + (w.title ? '<b>' + esc(w.title) + '</b>' : '') + (w.caption ? '<p>' + esc(w.caption) + '</p>' : '') + wa + '</div>';
    lb.classList.add('show'); lb.setAttribute('aria-hidden', 'false'); if (!was) lockScroll(true);
    var c = lb.querySelector('[data-lb-close]'); if (c) c.focus({ preventScroll: true });
    [1, -1].forEach(function (d) { var n = lbList[(lbIndex + d + lbList.length) % lbList.length]; if (n) { var im = new Image(); im.src = n.url; } });
  }
  function closeLb() {
    if (!lb.classList.contains('show')) return;
    lb.classList.remove('show'); lb.setAttribute('aria-hidden', 'true'); lb.innerHTML = ''; lockScroll(false);
    if (lastFocus && document.contains(lastFocus)) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }

  // ---------- review form ----------
  var rvStars = 0, rvBusy = false;
  var PICK_T = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  function setStars(n, hoverOnly) {
    var picks = [].slice.call(document.querySelectorAll('#ppPicks .pp-pick'));
    picks.forEach(function (b, i) { b.classList.toggle('on', i < n); if (!hoverOnly) b.setAttribute('aria-checked', i + 1 === n ? 'true' : 'false'); });
    var t = document.getElementById('ppPickT'); if (t) t.textContent = PICK_T[n] || '';
  }
  function deviceKey() {
    try { var k = localStorage.getItem('sewza_pf_dev'); if (!k) { k = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'd' + Date.now() + Math.random().toString(36).slice(2, 12)); localStorage.setItem('sewza_pf_dev', k); } return k; } catch (e) { return null; }
  }
  function formMsg(t) { var m = document.getElementById('ppRvMsg'); if (m) m.textContent = t || ''; }
  function openModal() {
    if (!P) return;
    var done = false; try { done = localStorage.getItem('sewza_pf_rev_' + P.slug) === '1'; } catch (e) {}
    modalFocus = document.activeElement;
    modal.innerHTML = reviewModalHtml(); rvStars = 0;
    if (done) { document.getElementById('ppRvFormWrap').hidden = true; var th = document.getElementById('ppRvThanks'); th.hidden = false; document.getElementById('ppRvThanksP').textContent = 'You have already sent a review from this device. We appreciate it.'; }
    modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false'); lockScroll(true);
    var f = modal.querySelector(done ? '[data-modal-close]:not(.pp-mx)' : '.pp-pick'); if (f) f.focus({ preventScroll: true });
  }
  function closeModal() {
    if (!modal.classList.contains('show')) return;
    modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); lockScroll(false);
    if (modalFocus && document.contains(modalFocus)) try { modalFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  var RV_ERR = {
    not_found: 'This portfolio is not available for reviews right now.',
    own: 'You cannot review your own portfolio.',
    invalid_name: 'Please type your name (2 to 60 letters).',
    invalid_rating: 'Please tap the stars to choose a rating.',
    invalid_comment: 'Please write at least 10 letters about your experience.',
    busy: 'Many reviews were sent today. Please try again tomorrow.'
  };
  function submitReview(ev) {
    ev.preventDefault(); if (rvBusy) return;
    var name = (document.getElementById('ppRvName').value || '').replace(/\s+/g, ' ').trim();
    var text = (document.getElementById('ppRvText').value || '').trim();
    if (document.getElementById('ppRvHp').value) { showThanks('Your review was received.'); return; }     // hidden field filled in: a bot
    if (!rvStars) { formMsg(RV_ERR.invalid_rating); return; }
    if (name.length < 2) { formMsg(RV_ERR.invalid_name); document.getElementById('ppRvName').focus(); return; }
    if (text.length < 10) { formMsg(RV_ERR.invalid_comment); document.getElementById('ppRvText').focus(); return; }
    rvBusy = true; formMsg(''); var btn = document.getElementById('ppRvSend'); btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Sending…';
    fetchWithTimeout(BASE + '/rest/v1/rpc/portfolio_submit_review', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ p_slug: P.slug, p_name: name, p_rating: rvStars, p_comment: text, p_device: deviceKey() }) }, 15000)
      .then(function (res) {
        if (res.status === 404) return 'unavailable';
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      }).then(function (code) {
        if (code === 'ok') { try { localStorage.setItem('sewza_pf_rev_' + P.slug, '1'); } catch (e) {} showThanks('Your review was sent. It will appear on this page once ' + P.name + ' approves it.'); }
        else if (code === 'duplicate') { try { localStorage.setItem('sewza_pf_rev_' + P.slug, '1'); } catch (e) {} showThanks('You have already sent a review from this device. We appreciate it.'); }
        else if (code === 'unavailable') formMsg('Reviews are not switched on for this portfolio yet. Please try again later.');
        else formMsg(RV_ERR[code] || 'Your review could not be sent. Please try again.');
      }).catch(function () { formMsg('Internet failed. Please check your connection and try again.'); })
      .then(function () { rvBusy = false; var b = document.getElementById('ppRvSend'); if (b) { b.disabled = false; b.classList.remove('busy'); b.textContent = 'Send my review'; } });
  }
  function showThanks(msg) {
    var w = document.getElementById('ppRvFormWrap'), t = document.getElementById('ppRvThanks'); if (!w || !t) return;
    w.hidden = true; t.hidden = false; document.getElementById('ppRvThanksP').textContent = msg;
    var b = t.querySelector('button'); if (b) b.focus({ preventScroll: true });
  }

  // ---------- events (bound once) ----------
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('[data-share]')) { share(); return; }
    var chip = t.closest('[data-cat]'); if (chip && P) { cat = chip.getAttribute('data-cat'); gridLimit = 12; document.querySelectorAll('.pp-chip').forEach(function (c) { var on = c.getAttribute('data-cat') === cat; c.classList.toggle('on', on); c.setAttribute('aria-selected', on); }); drawGrid(); return; }
    if (t.closest('[data-more]')) { gridLimit += 12; drawGrid(); return; }
    var tile = t.closest('.pp-tile'); if (tile) { openLb(Number(tile.getAttribute('data-i')) || 0, shown); return; }
    if (t.closest('[data-lb-close]') || t === lb) { closeLb(); return; }
    if (t.closest('[data-lb-prev]')) { openLb(lbIndex - 1, lbList); return; }
    if (t.closest('[data-lb-next]')) { openLb(lbIndex + 1, lbList); return; }
    if (t.classList.contains('pp-lb-stage')) { closeLb(); return; }
    if (t.closest('[data-sl-prev]')) { slGo(sl.i - 1, true); return; }
    if (t.closest('[data-sl-next]')) { slGo(sl.i + 1, true); return; }
    if (t.closest('[data-sl-view]')) { openLb(sl.i, slideList); return; }
    if (t.closest('[data-sl-play]')) { sl.userPaused = !sl.userPaused; slSchedule(); return; }
    var fq = t.closest('[data-faq]'); if (fq) { var open = fq.getAttribute('aria-expanded') === 'true'; fq.setAttribute('aria-expanded', open ? 'false' : 'true'); fq.parentNode.classList.toggle('open', !open); return; }
    if (t.closest('[data-rv-open]')) { openModal(); return; }
    if (t.closest('[data-rv-more]')) {
      var list = document.getElementById('ppRvList'); if (list) { list.insertAdjacentHTML('beforeend', R.items.slice(6).map(function (x, i) { return reviewCard(x, i); }).join('')); observeReveal(list); }
      var mw = t.closest('.pp-more-wrap'); if (mw) mw.parentNode.removeChild(mw); return;
    }
    if (t.closest('[data-modal-close]') || t === modal) { closeModal(); return; }
    var pick = t.closest('.pp-pick'); if (pick) { rvStars = Number(pick.getAttribute('data-v')) || 0; setStars(rvStars); formMsg(''); return; }
    if (t.closest('[data-wa-close]')) { closeBubble(); e.preventDefault(); return; }
    if (t.closest('#ppBurger')) { var d = document.getElementById('ppDrawer'); setDrawer(!(d && d.classList.contains('open'))); return; }
    var nl = t.closest('.pp-drawer a'); if (nl) { setDrawer(false); return; }
    if (t.closest('.pp-wa-btn')) { closeBubble(); }
  });
  document.addEventListener('mouseover', function (e) { var p = e.target instanceof Element ? e.target.closest('.pp-pick') : null; if (p) setStars(Number(p.getAttribute('data-v')) || 0, true); });
  document.addEventListener('mouseout', function (e) { var p = e.target instanceof Element ? e.target.closest('.pp-pick') : null; if (p) setStars(rvStars, true); });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'ppRvText') { var c = document.getElementById('ppRvCount'); if (c) c.textContent = e.target.value.length + ' / 600 (at least 10 letters)'; formMsg(''); }
    else if (e.target && e.target.id === 'ppRvName') formMsg('');
  });
  document.addEventListener('submit', function (e) { if (e.target && e.target.id === 'ppRvForm') submitReview(e); });
  document.addEventListener('keydown', function (e) {
    if (modal.classList.contains('show')) {
      if (e.key === 'Escape') { closeModal(); return; }
      var pk = e.target instanceof Element ? e.target.closest('.pp-pick') : null;
      if (pk && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); rvStars = Math.max(1, Math.min(5, (rvStars || Number(pk.getAttribute('data-v'))) + (e.key === 'ArrowRight' ? 1 : -1))); setStars(rvStars); var nb = document.querySelector('#ppPicks .pp-pick[data-v="' + rvStars + '"]'); if (nb) nb.focus(); return; }
      if (e.key === 'Tab') { var fs = modal.querySelectorAll('button:not([disabled]),input:not(.pp-hp),textarea,a[href]'); fs = [].filter.call(fs, function (n) { return n.offsetParent !== null; }); if (!fs.length) return; var f0 = fs[0], fz = fs[fs.length - 1]; if (e.shiftKey && document.activeElement === f0) { e.preventDefault(); fz.focus(); } else if (!e.shiftKey && document.activeElement === fz) { e.preventDefault(); f0.focus(); } }
      return;
    }
    if (e.key === 'Escape') { var dr = document.getElementById('ppDrawer'); if (dr && dr.classList.contains('open')) setDrawer(false); }
    if (!lb.classList.contains('show')) return;
    if (e.key === 'Escape') closeLb(); else if (e.key === 'ArrowLeft') openLb(lbIndex - 1, lbList); else if (e.key === 'ArrowRight') openLb(lbIndex + 1, lbList);
    else if (e.key === 'Tab') { var f = lb.querySelectorAll('button,a[href]'); if (!f.length) return; var a0 = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a0) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a0.focus(); } }
  });
  var sx = 0, sy = 0;
  lb.addEventListener('touchstart', function (e) { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
  lb.addEventListener('touchend', function (e) { var t = e.changedTouches[0]; if (!t) return; var dx = t.clientX - sx, dy = t.clientY - sy; if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) openLb(lbIndex + (dx < 0 ? 1 : -1), lbList); }, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { if (sl) slPlace(); onScroll(); });
  document.addEventListener('visibilitychange', function () { if (sl) slSchedule(); });

  // ---------- start ----------
  function start() {
    var slug = slugFromUrl();
    if (!BASE || !KEY) { gone('Portfolio unavailable', 'This page is not set up yet. Please try again later.'); return; }
    if (!slug) { gone('Portfolio not found', 'This link looks incomplete. Please ask the tailor to send the link again.'); return; }
    load(slug).then(function (p) {
      if (!p) { gone('Portfolio not found', 'This portfolio is not available. The tailor may have changed or turned off the link.'); return; }
      P = p; S = P.settings; cat = 'All'; gridLimit = 12; R = { state: S.showReviews && P.uid ? 'loading' : 'off', items: [], avg: 0, count: 0, dist: [0, 0, 0, 0, 0] };
      render(); track(slug);
      if (R.state === 'loading') loadReviews().then(function () { refreshReviews(); if (/^#review/.test(location.hash) && R.state !== 'off') openModal(); });
    }).catch(function () { gone('Internet failed', 'Please check your connection and try again.', true); });
  }
  start();
})();
