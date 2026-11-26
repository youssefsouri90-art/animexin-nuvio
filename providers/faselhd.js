/**
 * FaselHD (Arabic) - Nuvio provider
 * Port of the Eclipsia/re-3arabi CloudStream plugin logic (search -> season -> episode -> player -> m3u8).
 * NOTE: the original uses a WebView to pass Cloudflare and to sniff the m3u8. This port does it with plain
 * HTTP requests, so it works only while the site/player is reachable without a Cloudflare challenge.
 */
// Your own TMDB v3 API key (themoviedb.org > Settings > API > "API Key").
var MY_TMDB_KEY = '4d15cca3b68f75e9a08080dbe6a0568b';
var TMDB_KEY = MY_TMDB_KEY || (typeof TMDB_API_KEY !== 'undefined' && TMDB_API_KEY) || '439c478a771f35c05022f9feabcca01c';
var DEFAULT_BASE = 'https://www.faselhd.cc';
var BASE = DEFAULT_BASE;
// DIAG = true: when nothing is found, return one fake entry whose title shows the reason (visible inside Nuvio). Set false when done testing.
var VER = '0.1.5';
var DIAG = true;
var LAST_ERR = '';
var DEBUG = (typeof process !== 'undefined' && process.env && !!process.env.FASEL_DEBUG);
var ENV = (typeof process !== 'undefined' && process.env) ? process.env : {};
var SET = (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS : {};
// Cloudflare bypass: paste a cf_clearance cookie (and the SAME User-Agent) from a browser that opened the site.
// Termux: FASEL_COOKIE="cf_clearance=..." FASEL_UA="..." node ...   |  Nuvio: edit the two constants below.
// Optional manual Cloudflare bypass for testing: paste cf_clearance (and the SAME browser User-Agent) here. Expires, IP-bound.
var MY_CF_COOKIE = '';   // e.g. 'cf_clearance=xxxxx'
var MY_CF_UA = '';       // e.g. navigator.userAgent of the browser that got the cookie
var CF_COOKIE = ENV.FASEL_COOKIE || SET.cookie || MY_CF_COOKIE || '';
if (/[^\x20-\x7e]/.test(CF_COOKIE)) { CF_COOKIE = ''; if (ENV.FASEL_DEBUG) console.log('[FaselHD] cookie ignored: contains non-ASCII characters'); }
var UA = ENV.FASEL_UA || SET.userAgent || MY_CF_UA || 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
if (/[^\x20-\x7e]/.test(UA)) UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

function log() {
  var first = String(arguments[0] || '');
  if (/failed|error|Cloudflare/i.test(first + ' ' + String(arguments[1] || ''))) LAST_ERR = [].slice.call(arguments).join(' ').slice(0, 140); if (DEBUG && typeof console !== 'undefined') console.log.apply(console, ['[FaselHD]'].concat([].slice.call(arguments))); }

// Same header set as the original plugin's getModernHeaders().
function headers(ref) {
  return {
    'User-Agent': UA,
    'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'upgrade-insecure-requests': '1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'sec-fetch-site': 'none',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'Accept-Language': 'ar-EG,ar;q=0.9',
    'priority': 'u=0, i',
    'Referer': ref || (BASE + '/')
  };
}

function get(url, ref) {
  var h = headers(ref);
  if (CF_COOKIE && originOf(url) === originOf(BASE)) h['Cookie'] = CF_COOKIE;
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url + (r.status === 403 || r.status === 503 ? ' (Cloudflare? set FASEL_COOKIE)' : ''));
    if (r.url && url.indexOf(BASE) === 0) {
      var m = /^(https?:\/\/[^\/]+)/.exec(r.url);
      if (m && m[1] !== BASE) { log('base moved to', m[1]); BASE = m[1]; }
    }
    return r.text();
  }).then(function (html) {
    if (/Just a moment|cf-chl|challenge-platform/i.test(html) && html.length < 20000) throw new Error('Cloudflare challenge: ' + url);
    return html;
  });
}

function abs(u, ref) {
  u = String(u || '').replace(/&amp;/g, '&').trim();
  if (!u) return '';
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return BASE + u;
  if (/^https?:/i.test(u)) return u;
  return BASE + '/' + u;
}

function arDigits(s) { return String(s).replace(/[\u0660-\u0669]/g, function (d) { return d.charCodeAt(0) - 1632; }); }

function norm(s) {
  return arDigits(String(s || '')).toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\b(مسلسل|فيلم|انمي|أنمي|مترجم|مترجمه|مدبلج|مشاهده|مشاهدة|الموسم|موسم|season|الحلقه|حلقه|كامل|اون لاين)\b/g, ' ')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').replace(/\s+/g, ' ').trim();
}

var ORD = { 'الاول': 1, 'الاولي': 1, 'الثاني': 2, 'الثالث': 3, 'الرابع': 4, 'الخامس': 5, 'السادس': 6, 'السابع': 7, 'الثامن': 8, 'التاسع': 9, 'العاشر': 10 };
function seasonNumber(text, idx) {
  var t = norm(String(text || '')); var m = /(\d+)/.exec(arDigits(text || ''));
  if (m) return parseInt(m[1], 10);
  var words = (String(text || '').replace(/[\u064b-\u065f]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')).split(/\s+/);
  for (var i = 0; i < words.length; i++) if (ORD[words[i]]) return ORD[words[i]];
  return idx + 1;
}

function json(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

// Accepts 1429, "1429", "tmdb:1429", "tt0944947" (IMDb), "tt0944947:1:2" (Stremio style).
function resolveTmdbId(raw, type) {
  var s = String(raw == null ? '' : raw).trim();
  var imdb = /tt\d{5,}/.exec(s);
  if (imdb) {
    var url = 'https://api.themoviedb.org/3/find/' + imdb[0] + '?api_key=' + TMDB_KEY + '&external_source=imdb_id';
    return fetch(url).then(json).then(function (r) {
      var list = type === 'movie' ? r.movie_results : r.tv_results;
      if (!list || !list.length) list = (r.movie_results || []).concat(r.tv_results || []);
      if (!list.length) throw new Error('imdb id not found on TMDB: ' + imdb[0]);
      return String(list[0].id);
    });
  }
  var num = /(\d+)\s*$/.exec(s.replace(/^tmdb[:\-]?/i, '')) || /(\d+)/.exec(s);
  if (!num) return Promise.reject(new Error('unrecognised id: ' + s));
  return Promise.resolve(num[1]);
}

function tmdbTitles(id, type) {
  var kind = type === 'movie' ? 'movie' : 'tv';
  var base = 'https://api.themoviedb.org/3/' + kind + '/' + id + '?api_key=' + TMDB_KEY;
  return Promise.all([
    fetch(base + '&language=en-US').then(json),
    fetch(base + '&language=ar').then(json).catch(function () { return null; })
  ]).then(function (r) {
    var en = r[0], ar = r[1], names = [];
    function add(x) { if (x && names.indexOf(x) < 0) names.push(x); }
    if (ar) add(ar.title || ar.name);
    add(en.title || en.name); add(en.original_title || en.original_name);
    var year = String((en.release_date || en.first_air_date || '')).slice(0, 4);
    return { names: names, year: year };
  });
}

function parseCards(html) {
  var out = [], seen = {};
  var parts = html.split(/class="[^"]*\b(?:postDiv|blockMovie|search-item)\b[^"]*"/);
  parts.shift();
  parts.forEach(function (p) {
    p = p.slice(0, 1800);
    var h = /href="([^"]+)"/.exec(p); if (!h) return;
    var t = /class="[^"]*\bh[145]\b[^"]*"[^>]*>\s*([^<]+)</.exec(p) || /alt="([^"]+)"/.exec(p) || /title="([^"]+)"/.exec(p);
    var url = abs(h[1]); if (seen[url]) return; seen[url] = 1;
    out.push({ url: url, title: t ? t[1].trim() : '' });
  });
  return out;
}

function searchAjax(q) {
  var h = headers(BASE + '/');
  h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  h['X-Requested-With'] = 'XMLHttpRequest';
  h['Accept'] = '*/*';
  if (CF_COOKIE) h['Cookie'] = CF_COOKIE;
  return fetch(BASE + '/wp-admin/admin-ajax.php', {
    method: 'POST', headers: h,
    body: 'action=dtc_live&trsearch=' + encodeURIComponent(q)
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ajax search');
    return r.text();
  }).then(parseCards);
}

function search(q) {
  return get(BASE + '/?s=' + encodeURIComponent(q)).then(parseCards).then(function (cards) {
    if (cards.length) return cards;
    return searchAjax(q);
  });
}

function pickCard(cards, names, year, isTv) {
  var best = null, bestScore = 0;
  cards.forEach(function (c) {
    var ct = norm(c.title), score = 0;
    names.forEach(function (n) {
      var nn = norm(n); if (!nn) return;
      if (ct === nn) score = Math.max(score, 100);
      else if (ct.indexOf(nn) === 0) score = Math.max(score, 80);
      else if (ct.indexOf(nn) >= 0 || (ct && nn.indexOf(ct) >= 0)) score = Math.max(score, 60);
    });
    if (!score) return;
    if (!isTv && year && (c.title.indexOf(year) >= 0)) score += 15;
    if (score > bestScore) { best = c; bestScore = score; }
  });
  return best;
}

function seasonLinks(html) {
  var out = [], re = /<div[^>]*\bseasonDiv\b[^>]*>/g, m, i = 0;
  while ((m = re.exec(html))) {
    var chunk = html.slice(m.index, m.index + 700);
    var u = /window\.location\.href\s*=\s*['"]([^'"]+)['"]/.exec(chunk);
    var t = /class="[^"]*\btitle\b[^"]*"[^>]*>\s*([^<]+)</.exec(chunk);
    if (u) out.push({ url: abs(u[1]), title: t ? t[1].trim() : '', n: seasonNumber(t ? t[1] : '', i) });
    i++;
  }
  return out;
}

function episodeLinks(html) {
  var i = html.indexOf('id="epAll"'); if (i < 0) return [];
  var block = html.slice(i, i + 60000), end = block.indexOf('</div>'); if (end > 0) block = block.slice(0, end);
  var out = [], re = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, m, k = 0;
  while ((m = re.exec(block))) {
    var txt = arDigits(m[2].replace(/<[^>]+>/g, ' '));
    var n = /(\d+)/.exec(txt);
    out.push({ url: abs(m[1]), n: n ? parseInt(n[1], 10) : k + 1 });
    k++;
  }
  return out;
}

var AD = /recaptcha|googlesyndication|googletagmanager|google\.com\/ads|melbet|doubleclick/i;
function playerUrls(html) {
  var out = [];
  function add(u) { u = abs(u); if (u && !AD.test(u) && out.indexOf(u) < 0) out.push(u); }
  var re = /player_iframe\.location\.href\s*=\s*['"]([^'"]+)['"]/g, m;
  while ((m = re.exec(html))) add(m[1]);
  re = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  while ((m = re.exec(html))) add(m[1]);
  re = /https?:\/\/[^'"\s<>]+video_player[^'"\s<>]*/g;
  while ((m = re.exec(html))) add(m[0]);
  return out;
}

function unpack(src) {
  var m = /\}\('([\s\S]*)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/.exec(src);
  if (!m) return '';
  var p = m[1].replace(/\\'/g, "'"), a = parseInt(m[2], 10), c = parseInt(m[3], 10), k = m[4].split('|');
  function e(n) { return (n < a ? '' : e(parseInt(n / a, 10))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36)); }
  var d = {};
  while (c--) d[e(c)] = k[c] || e(c);
  return p.replace(/\b\w+\b/g, function (w) { return d[w] || w; });
}

function findM3u8(html) {
  var texts = [html];
  var pk = /eval\(function\(p,a,c,k,e,[\s\S]*?\.split\('\|'\)[^\n]*/.exec(html);
  if (pk) { var u = unpack(pk[0]); if (u) texts.push(u); }
  var out = [];
  texts.forEach(function (t) {
    t = t.replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
    var re = /https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g, m;
    while ((m = re.exec(t))) if (out.indexOf(m[0]) < 0) out.push(m[0]);
  });
  return out;
}

function originOf(u) { var m = /^(https?:\/\/[^\/]+)/.exec(u); return m ? m[1] : BASE; }

function resolvePlayer(url, ref, depth) {
  return get(url, ref).then(function (html) {
    var found = findM3u8(html);
    if (found.length) return found.map(function (u) { return { url: u, ref: url }; });
    if (depth >= 1) return [];
    var inner = playerUrls(html).filter(function (u) { return u !== url; });
    return Promise.all(inner.slice(0, 3).map(function (u) {
      return resolvePlayer(u, url, depth + 1).catch(function () { return []; });
    })).then(function (r) { return [].concat.apply([], r); });
  });
}

function findTargetPage(info, type, season, episode) {
  var isTv = type !== 'movie';
  var names = info.names.slice(0, 3), idx = 0;
  function next() {
    if (idx >= names.length) return Promise.resolve(null);
    var q = names[idx++];
    return search(q).then(function (cards) {
      var c = pickCard(cards, info.names, info.year, isTv);
      return c || next();
    }).catch(function (e) { log('search failed', q, e.message); return next(); });
  }
  return next().then(function (card) {
    if (!card) return null;
    log('matched', card.title, card.url);
    return get(card.url).then(function (html) {
      if (!isTv) return { url: card.url, html: html };
      var seasons = seasonLinks(html), target = card.url, p = Promise.resolve(html);
      var hit = null;
      seasons.forEach(function (s) { if (s.n === season) hit = s; });
      if (hit && hit.url !== card.url) { target = hit.url; p = get(target, card.url); }
      else if (!hit && season !== 1 && seasons.length) return null;
      return p.then(function (shtml) {
        var eps = episodeLinks(shtml), ep = null;
        eps.forEach(function (e) { if (e.n === episode) ep = e; });
        if (!ep && eps[episode - 1]) ep = eps[episode - 1];
        if (!ep) return null;
        return get(ep.url, target).then(function (ehtml) { return { url: ep.url, html: ehtml }; });
      });
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === 'movie' ? 'movie' : 'tv';
  LAST_ERR = '';
  var RECV = type + ' ' + String(tmdbId).slice(0, 14) + (type === 'tv' ? ' S' + season + 'E' + episode : '');
  return resolveTmdbId(tmdbId, type).then(function (id) { return tmdbTitles(id, type); }).then(function (info) {
    return findTargetPage(info, type, parseInt(season, 10) || 1, parseInt(episode, 10) || 1);
  }).then(function (page) {
    if (!page) return [];
    var players = playerUrls(page.html);
    log('players', players);
    return Promise.all(players.map(function (u, i) {
      return resolvePlayer(u, page.url, 0).then(function (list) {
        return list.map(function (x) { return { server: i + 1, url: x.url, ref: x.ref }; });
      }).catch(function (e) { log('player failed', u, e.message); return []; });
    })).then(function (r) {
      var seen = {}, out = [];
      [].concat.apply([], r).forEach(function (x) {
        if (seen[x.url]) return; seen[x.url] = 1;
        out.push({
          name: 'FaselHD • Server ' + x.server,
          title: 'FaselHD • Server ' + x.server,
          url: x.url, type: 'hls', quality: 'Auto',
          headers: { 'User-Agent': UA, 'Referer': originOf(x.ref) + '/', 'Origin': originOf(x.ref) },
          subtitles: []
        });
      });
      return out;
    });
  }).catch(function (e) { log('error', e.message); return []; }).then(function (out) {
    if (!out.length && DIAG) {
      var why = LAST_ERR || 'no match / no players found';
      var step = (/(search|player) failed/.exec(why) || [])[1] || '';
      var code = /HTTP (\d+)/.exec(why);
      var brief = code ? (step ? step + ' ' : '') + 'HTTP ' + code[1]
        : /Cloudflare challenge/.test(why) ? (step ? step + ' ' : '') + 'CF challenge'
        : /fetch|network|TypeError/i.test(why) ? 'network error'
        : why.slice(0, 40);
      return [{ name: 'FaselHD v' + VER + ' • ' + RECV + ' • ' + brief, title: 'DIAG: ' + RECV + ' | ' + why, url: 'https://diag.invalid/none.m3u8', type: 'hls', quality: brief.slice(0, 20), headers: {}, subtitles: [] }];
    }
    return out;
  });
}

module.exports = { getStreams: getStreams };
