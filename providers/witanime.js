// WitAnime provider for Nuvio (QuickJS runtime: no DOM, no Node APIs).
// Flow: TMDB titles (EN + AR) -> search witanime -> anime page -> episode page
//       -> collect server embeds (iframes / data-attrs / base64 blobs)
//       -> resolve each host -> quality list (Dailymotion up to 4K with desktop UA).

// If the site moves to another mirror, change only this line.
const BASE = "https://witanime.site";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

// Site / TMDB / generic hosts: mobile UA.
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
};
// Dailymotion only: desktop UA (serves higher qualities, up to 4K).
const UA_DM = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

// Server priority (lower = shown first). Unlisted hosts get the default priority.
// Set ONLY_PRIORITY_HOSTS to true to ignore every host that is not listed here.
const ONLY_PRIORITY_HOSTS = false;
const PRIORITY = [
  { key: "Mp4upload", re: /mp4upload\.com/i },
  { key: "HGCloud", re: /hgcloud|hglink|hgplay/i },
  { key: "Dailymotion", re: /dailymotion\.com|dai\.ly/i },
  { key: "Rumble", re: /rumble\.com/i },
  { key: "Dood", re: /dood|d000d|ds2play|dsvplay|d0o0d|do7go/i },
  { key: "OK.ru", re: /ok\.ru/i },
  { key: "StreamWish", re: /streamwish|wishfast|awish|hlswish|swhoi|sfastwish|strwish/i },
  { key: "VidHide", re: /vidhide|filelions|vidhidepro|ahvsh|dhcplay/i },
  { key: "Uqload", re: /uqload/i },
  { key: "YourUpload", re: /yourupload\.com/i },
  { key: "Voe", re: /voe\.sx|voe-/i },
  { key: "Streamtape", re: /streamtape|strtape|stape/i },
  { key: "Mixdrop", re: /mixdrop|mxdrop/i },
  { key: "Sibnet", re: /sibnet\.ru/i },
  { key: "Mediafire", re: /mediafire\.com/i },
];
const SKIP = /(histats|google|gstatic|facebook|twitter|t\.me|whatsapp|gravatar|wp-content|wp-json|wp-includes|disqus|cloudflare|jquery|bootstrap|fontawesome|schema\.org|w3\.org|youtube\.com\/(?:channel|c\/|@)|instagram|tiktok|discord|telegram|mega\.nz|mega\.io|drive\.google|1fichier|workupload|gofile|\.(?:png|jpe?g|gif|webp|svg|ico|css|js|woff2?|ttf)(?:\?|$))/i;

const DIAG = [];

// ---------- helpers ----------
function b64decode(str) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  str = String(str).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  let out = "", bits = 0, val = 0;
  for (let i = 0; i < str.length; i++) {
    val = (val << 6) | chars.indexOf(str[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((val >> bits) & 0xff); }
  }
  return out;
}

// Unicode-aware: keeps Arabic letters so Arabic titles/slugs can be compared.
const norm = (s) =>
  String(s || "").toLowerCase()
    .replace(/&#8217;|&#039;|&amp;|’|'/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();

function similarity(a, b) {
  const A = new Set(norm(a).split(" ")), B = new Set(norm(b).split(" "));
  let hit = 0;
  A.forEach((w) => B.has(w) && hit++);
  return hit / Math.max(A.size, B.size, 1);
}

function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

async function getText(url, headers) {
  const r = await fetch(url, { headers: Object.assign({}, UA, headers || {}) });
  return await r.text();
}

function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(u);
  return m ? m[1] : u;
}

function absUrl(base, rel) {
  if (/^https?:/i.test(rel)) return rel;
  if (/^\/\//.test(rel)) return "https:" + rel;
  if (rel[0] === "/") return base.replace(/^(https?:\/\/[^\/]+).*/, "$1") + rel;
  return base.replace(/[^\/]*$/, "") + rel;
}

function randHex(n) {
  let s = "";
  while (s.length < n) s += Math.floor(Math.random() * 16).toString(16);
  return s.toUpperCase();
}

function randAlnum(n) {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

// Dean Edwards p.a.c.k.e.r unpacker (used by StreamWish / VidHide / Mp4upload ...).
function unpack(src) {
  try {
    const m = /\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/.exec(src);
    if (!m) return "";
    let p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const a = parseInt(m[2], 10);
    let c = parseInt(m[3], 10);
    const k = m[4].split("|");
    const base = (n) =>
      (n < a ? "" : base(Math.floor(n / a))) +
      ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    while (c--) {
      if (k[c]) p = p.replace(new RegExp("\\b" + base(c) + "\\b", "g"), k[c]);
    }
    return p;
  } catch (e) { return ""; }
}

// ---------- titles (TMDB + AniList romaji) ----------
async function getTmdbTitles(tmdbId, mediaType) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const out = [];
  const grab = async (lang) => {
    try {
      const j = await (await fetch(
        `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=${lang}`
      )).json();
      [j.name || j.title, j.original_name || j.original_title].forEach((t) => {
        if (t && out.indexOf(t) < 0) out.push(t);
      });
    } catch (e) {}
  };
  await grab("en-US");
  await grab("ar-SA");
  return out;
}

const ORD = { 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th" };
const ORDW = { 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth" };

function seasonRe(n) {
  return new RegExp("(?:\\b" + n + "(?:st|nd|rd|th) season|season " + n + "\\b|\\b" + (ORDW[n] || "zzz") + " season|\\b" + n + "nd\\b|\\b" + n + "rd\\b|\\b" + n + "th\\b)", "i");
}

// The site slugs are romaji ("koori-no-jouheki-2nd-season"), which TMDB does not
// give for non-English titles, so ask AniList for the romaji/english titles.
async function anilistTitles(queries, season) {
  const out = [];
  const q = "query($s:String){Page(perPage:6){media(search:$s,type:ANIME){title{romaji english} synonyms}}}";
  for (const text of queries.slice(0, 3)) {
    try {
      const r = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: q, variables: { s: text } }),
      });
      const j = await r.json();
      const media = (j && j.data && j.data.Page && j.data.Page.media) || [];
      let best = null;
      media.forEach((m) => {
        const names = [m.title.romaji, m.title.english].concat(m.synonyms || []).filter(Boolean);
        let score = Math.max.apply(null, names.map((n) => similarity(text, n)).concat([0]));
        const hay = names.join(" | ");
        if (season > 1) score += seasonRe(season).test(hay) ? 0.4 : -0.2;
        else if (/\b(2nd|3rd|4th|season [2-9])\b/i.test(hay)) score -= 0.2;
        if (!best || score > best.score) best = { score, m };
      });
      if (best && best.score >= 0.5) {
        [best.m.title.romaji, best.m.title.english].forEach((t) => {
          if (t && out.indexOf(t) < 0) out.push(t);
        });
        break;
      }
    } catch (e) { DIAG.push("anilist err " + (e && e.message)); }
  }
  return out;
}

// ---------- site ----------
const slugify = (t) =>
  String(t || "").toLowerCase().replace(/&#?\w+;/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function slugCandidates(titles, season) {
  const out = [];
  const add = (s) => { if (s && out.indexOf(s) < 0) out.push(s); };
  titles.forEach((t) => {
    const base = slugify(t);
    if (!base) return;
    add(base);
    if (season > 1 && !seasonRe(season).test(t)) {
      add(base + "-" + ORD[season] + "-season");
      add(base + "-season-" + season);
    }
  });
  return out.slice(0, 8);
}

// Watch page: /watch/{slug}/{episode}
async function tryWatch(slug, episode) {
  const url = `${BASE}/watch/${slug}/${episode}`;
  try {
    const r = await fetch(url, { headers: Object.assign({}, UA, { Referer: BASE + "/" }) });
    const html = await r.text();
    const bad = (r.status && r.status >= 400) || html.length < 1500 || /<title>[^<]*(404|not found|غير موجود)/i.test(html);
    DIAG.push("try " + slug + ":" + (r.status || "?") + "/" + html.length + (bad ? ":x" : ":ok"));
    return bad ? null : { url, html };
  } catch (e) {
    DIAG.push("try " + slug + ":err");
    return null;
  }
}

async function search(query) {
  const urls = [
    `${BASE}/?search_param=animes&s=${encodeURIComponent(query)}`,
    `${BASE}/?s=${encodeURIComponent(query)}`,
  ];
  for (const u of urls) {
    let html = "";
    try { html = await getText(u); } catch (e) { continue; }
    const results = [], seen = {};
    const re = /<a[^>]+href="((?:https?:\/\/[^"\/]+)?\/(?:watch|anime)\/([^"\/#?]+)[^"#?]*)"[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      const slug = m[2];
      if (seen[slug]) continue;
      seen[slug] = 1;
      const t = /title="([^"]+)"/i.exec(m[0]);
      const slugTitle = safeDecode(slug).replace(/-/g, " ");
      results.push({ slug, title: t ? t[1] : slugTitle, slugTitle });
    }
    DIAG.push("search " + results.length);
    if (results.length) return results;
  }
  return [];
}

async function findBySearch(titles, season, episode) {
  const queries = [];
  titles.forEach((t) => {
    if (season > 1) queries.push(`${t} ${ORD[season] || season} season`);
    queries.push(t);
  });
  let best = null;
  for (const q of queries.slice(0, 6)) {
    for (const r of await search(q)) {
      let score = Math.max(similarity(q, r.title), similarity(q, r.slugTitle));
      if (season > 1 && seasonRe(season).test(r.title + " " + r.slugTitle)) score += 0.3;
      if (!best || score > best.score) best = Object.assign({ score }, r);
    }
    if (best && best.score >= 0.8) break;
  }
  if (!best || best.score < 0.5) return null;
  DIAG.push("search-best " + best.slug);
  return await tryWatch(best.slug, episode);
}

// ---------- server discovery ----------
function cleanUrl(u) {
  return String(u).replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/^\/\//, "https://").trim();
}

function kindOf(url) {
  for (let i = 0; i < PRIORITY.length; i++) if (PRIORITY[i].re.test(url)) return { key: PRIORITY[i].key, prio: i };
  return { key: hostOf(url).replace(/^www\./, ""), prio: PRIORITY.length };
}

// The page offers SD / HD / FHD tabs; each tab has its own server links.
const TAB_H = { FHD: 1080, "1080": 1080, "1080P": 1080, HD: 720, "720": 720, "720P": 720, SD: 480, "480": 480, "480P": 480 };

function normalizeText(html) {
  return String(html)
    .replace(/\\u002F/gi, "/").replace(/\\u0026/gi, "&").replace(/\\u003D/gi, "=")
    .replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/&amp;/g, "&");
}

// look around an URL for a quality tag (FHD/HD/SD/1080p...)
function tabNear(text, idx) {
  const win = text.slice(Math.max(0, idx - 260), idx + 160);
  const re = /["'>:\s](FHD|HD|SD|1080p?|720p?|480p?)["'<\s,}]/gi;
  let m, best = null, bestD = 1e9;
  while ((m = re.exec(win))) {
    const d = Math.abs(m.index - 260);
    if (d < bestD) { bestD = d; best = m[1].toUpperCase(); }
  }
  return best && TAB_H[best] ? best : "";
}

function extractServers(html) {
  const out = [], seen = {};
  const text = normalizeText(html);
  const add = (u, tab) => {
    u = cleanUrl(u);
    if (!/^https?:\/\//i.test(u)) return;
    if (u.indexOf(hostOf(BASE)) >= 0 && !/embed|player/i.test(u)) return; // site's own pages
    if (SKIP.test(u)) return;
    const key = u + "|" + (tab || "");
    if (seen[key]) return;
    seen[key] = 1;
    const k = kindOf(u);
    if (ONLY_PRIORITY_HOSTS && k.prio >= PRIORITY.length) return;
    out.push({ url: u, kind: k.key, prio: k.prio, tab: tab || "" });
  };
  let m;

  // 1) iframes (also lazy ones)
  const ifr = /<iframe[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi;
  while ((m = ifr.exec(text))) add(m[1], tabNear(text, m.index));

  // 2) data-* attributes holding an URL (server buttons)
  const du = /data-[\w-]*(?:url|src|embed|link|video|server)[\w-]*=["']((?:https?:)?\/\/[^"']+)["']/gi;
  while ((m = du.exec(text))) add(m[1], tabNear(text, m.index));

  // 3) URLs of known hosts anywhere (HTML, inline JSON, Next.js payloads)
  const kh = /https?:\/\/[^"'\s<>\\]+/g;
  while ((m = kh.exec(text))) {
    const u = cleanUrl(m[0]);
    if (PRIORITY.some((p) => p.re.test(u))) add(u, tabNear(text, m.index));
  }

  // 4) base64 blobs (value=, data-*=, JS strings): decode, then scan for URLs / iframes.
  const blob = /["']([A-Za-z0-9+/_\-]{40,}={0,2})["']/g;
  let n = 0;
  while ((m = blob.exec(text)) && n < 60) {
    n++;
    let dd = b64decode(m[1]);
    if (!/https?:|<iframe|\\\//i.test(dd)) {
      const rev = b64decode(m[1].split("").reverse().join(""));
      if (/https?:|<iframe/i.test(rev)) dd = rev; else continue;
    }
    dd = normalizeText(safeDecode(dd));
    const tab = tabNear(text, m.index);
    const f = /<iframe[^>]+src=["']([^"']+)["']/gi;
    let x;
    while ((x = f.exec(dd))) add(x[1], tab);
    const u = /https?:\/\/[^"'\s<>\\]+/g;
    while ((x = u.exec(dd))) add(x[0], tab);
  }

  out.sort((a, b) => (a.prio - b.prio) || ((TAB_H[b.tab] || 0) - (TAB_H[a.tab] || 0)));
  return out;
}

// what the page looks like, for the DEBUG card when nothing was found
function pageDiag(html) {
  const t = String(html);
  const cnt = (re) => (t.match(re) || []).length;
  const api = [], seenA = {};
  const ar = /["'(](\/(?:api|wp-json|ajax|_next\/data)[\w\/\-\.?=&%]*)/g;
  let m;
  while ((m = ar.exec(t)) && api.length < 5) if (!seenA[m[1]]) { seenA[m[1]] = 1; api.push(m[1].slice(0, 60)); }
  const js = [], sr = /<script[^>]+src=["']([^"']+)["']/gi;
  while ((m = sr.exec(t)) && js.length < 4) js.push(m[1].replace(/^https?:\/\/[^\/]+/, "").slice(0, 40));
  DIAG.push("pg:len=" + t.length +
    " next=" + (/__NEXT_DATA__|__next_f/.test(t) ? 1 : 0) +
    " mp4up=" + cnt(/mp4upload/gi) + " hgc=" + cnt(/hgcloud/gi) + " videa=" + cnt(/videa/gi) +
    " iframe=" + cnt(/<iframe/gi) + " b64=" + cnt(/["'][A-Za-z0-9+\/]{60,}={0,2}["']/g));
  if (api.length) DIAG.push("api:" + api.join(","));
  if (js.length) DIAG.push("js:" + js.join(","));
  DIAG.push("body[" + t.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) + "]");
}

// ---------- quality handling ----------
function qualityLabel(h) {
  if (h >= 2000) return "2160p (4K)";
  if (h >= 1400) return "1440p";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h >= 460) return "480p";
  if (h >= 340) return "360p";
  return h + "p";
}

async function expandHls(masterUrl, hdrs) {
  const out = [{ url: masterUrl, quality: "Auto", height: 0, master: true }];
  try {
    const txt = await getText(masterUrl, hdrs);
    if (txt.indexOf("#EXTM3U") !== 0) DIAG.push("master?" + txt.length + ":" + txt.slice(0, 30).replace(/\s+/g, " "));
    const lines = txt.split(/\r?\n/);
    const byHeight = {};
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      let next = "";
      for (let k = i + 1; k < lines.length; k++) {
        const t = lines[k].trim();
        if (t && t[0] !== "#") { next = t; break; }
      }
      if (!next) continue;
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      const nm = /NAME="?(\d{3,4})p?"?/.exec(line);
      const hRaw = res ? parseInt(res[2], 10) : nm ? parseInt(nm[1], 10) : 0;
      const wRaw = res ? parseInt(res[1], 10) : 0;
      const h = Math.max(hRaw, Math.round((wRaw * 9) / 16)); // letterboxed video -> real tier
      if (!h) continue;
      const bw = parseInt((/(?:^|[,:])BANDWIDTH=(\d+)/.exec(line) || [0, 0])[1], 10);
      const avc = /avc1/i.test(line);
      const cur = byHeight[h];
      if (!cur || (avc && !cur.avc) || (avc === cur.avc && bw > cur.bw)) {
        byHeight[h] = { url: absUrl(masterUrl, next), height: h, bw: bw, avc: avc };
      }
    }
    const hs = Object.keys(byHeight).map(Number).sort((x, y) => y - x);
    if (hs.length) {
      out[0].quality = "Auto (up to " + qualityLabel(hs[0]) + ")";
      out[0].height = hs[0];
      hs.forEach((h) => out.push({ url: byHeight[h].url, quality: qualityLabel(h), height: h }));
    }
  } catch (e) {}
  return out;
}

const maxH = (links) => links.reduce((m, l) => Math.max(m, l.height || 0), 0);

// ---------- Dailymotion ----------
async function fetchJsonSafe(u, h) {
  try {
    const r = await fetch(u, { headers: h });
    const t = await r.text();
    const j = JSON.parse(t);
    return j && j.qualities ? j : null;
  } catch (e) { return null; }
}

async function linksFromMeta(j, H) {
  const q = j.qualities, out = [], seenH = {};
  try {
    Object.keys(q).forEach((k) => {
      if (!/^\d+$/.test(k)) return;
      (q[k] || []).forEach((it) => {
        if (!it || !it.url || it.type === "application/x-mpegURL") return;
        const h = parseInt(k, 10);
        if (seenH[h]) return;
        seenH[h] = 1;
        out.push({ url: it.url, quality: qualityLabel(h), height: h });
      });
    });
  } catch (e) {}
  const auto = q.auto && q.auto[0];
  if (auto && auto.url) {
    let hls = await expandHls(auto.url, UA_DM);
    if (hls.length === 1) hls = await expandHls(auto.url, H);
    hls.forEach((l) => { if (l.master || !seenH[l.height]) out.push(l); });
  }
  return out;
}

async function resolveDailymotion(url, pageUrl) {
  const id = (/[?&]video=([^&]+)/.exec(url) || /\/video\/([^?_\/]+)/.exec(url) || /dai\.ly\/([\w]+)/.exec(url) || [])[1];
  if (!id) return [];
  const playerId = (/\/player\/(\w+)\.html/.exec(url) || [])[1];
  const ref = pageUrl || BASE + "/";
  const origin = "https://" + hostOf(ref);
  const v1 = randHex(32), ts = String(Math.floor(Math.random() * 90000) + 10000);
  const H = Object.assign({}, UA_DM, { Referer: ref, Origin: origin, Cookie: "v1st=" + v1 + "; ts=" + ts });
  const plain = `https://www.dailymotion.com/player/metadata/video/${id}`;
  const full = plain + "?" + [
    "embedder=" + encodeURIComponent(ref),
    "geo=1",
    playerId ? "player-id=" + playerId : "",
    "locale=en-US",
    "dmV1st=" + v1,
    "dmTs=" + ts,
    "is_native_app=0",
  ].filter(Boolean).join("&");

  const attempts = [
    { name: "full", url: full, h: H },
    { name: "embedder", url: `${plain}?embedder=${encodeURIComponent(ref)}`, h: H },
    { name: "plain", url: plain, h: UA_DM },
  ];
  let best = [], bestName = "";
  for (const at of attempts) {
    const j = await fetchJsonSafe(at.url, at.h);
    if (!j) { DIAG.push("dm-" + at.name + ":fail"); continue; }
    const links = await linksFromMeta(j, at.h);
    const hs = links.map((l) => l.height).filter(Boolean).sort((x, y) => x - y);
    DIAG.push("dm-" + at.name + ":" + (hs.join("/") || "auto"));
    if (maxH(links) > maxH(best) || (!best.length && links.length)) { best = links; bestName = at.name; }
    if (maxH(best) >= 2000) break;
  }
  if (maxH(best) < 1000) {
    try {
      const j0 = await fetchJsonSafe(full, H);
      const xid = j0 && (j0.id || j0.video_id);
      if (xid && xid !== id) {
        const j = await fetchJsonSafe(`https://www.dailymotion.com/player/metadata/video/${xid}?embedder=${encodeURIComponent(ref)}&dmV1st=${v1}&dmTs=${ts}`, H);
        if (j) {
          const links = await linksFromMeta(j, H);
          DIAG.push("dm-xid:" + (links.map((l) => l.height).filter(Boolean).sort((x, y) => x - y).join("/") || "auto"));
          if (maxH(links) > maxH(best)) { best = links; bestName = "xid"; }
        }
      }
    } catch (e) {}
  }
  best.forEach((o) => { o.info = bestName; o.hdrs = UA; });
  return best;
}

// ---------- Rumble ----------
async function resolveRumble(url, pageUrl) {
  const id = (/\/embed\/([^/?]+)/.exec(url) || [])[1];
  if (!id) return [];
  const H = Object.assign({}, UA, { Referer: pageUrl || BASE + "/" });
  const txt = await getText(`https://rumble.com/embedJS/u3/?request=video&ver=2&v=${id}`, H);
  let j;
  try { j = JSON.parse(txt); } catch (e) { DIAG.push("rumble:badjson"); return []; }
  const PH = Object.assign({}, UA, { Referer: "https://rumble.com/" });
  const out = [], seen = {};
  const add = (u, h) => {
    if (!u || seen[u]) return;
    seen[u] = 1;
    out.push({ url: u, quality: qualityLabel(h), height: h, hdrs: PH });
  };
  [j.ua, j.u].forEach((root) => {
    if (!root) return;
    ["mp4", "webm"].forEach((fmt) => {
      const grp = root[fmt];
      if (!grp) return;
      Object.keys(grp).forEach((k) => {
        const it = grp[k];
        const h = (it && it.meta && it.meta.h) || parseInt(k, 10);
        if (h && it && it.url) add(it.url, h);
      });
    });
  });
  const hlsUrl =
    (j.ua && j.ua.hls && j.ua.hls.auto && j.ua.hls.auto.url) ||
    (j.u && j.u.hls && j.u.hls.auto && j.u.hls.auto.url);
  if (hlsUrl) {
    const list = await expandHls(hlsUrl, PH);
    list.forEach((l) => { if (!seen[l.url]) { seen[l.url] = 1; l.hdrs = PH; out.push(l); } });
  }
  DIAG.push("rumble:" + (out.map((l) => l.height).filter(Boolean).sort((x, y) => x - y).join("/") || "none"));
  return out;
}

// ---------- Dood ----------
async function resolveDood(url, pageUrl) {
  const embed = url.replace(/\/d\//, "/e/");
  const r = await fetch(embed, { headers: Object.assign({}, UA, { Referer: pageUrl || BASE + "/" }) });
  const html = await r.text();
  const finalUrl = (r && r.url) || embed;
  const origin = "https://" + hostOf(finalUrl);
  const pm = /\/pass_md5\/([^'"\s]+)/.exec(html);
  if (!pm) { DIAG.push("dood:nopass len=" + html.length); return []; }
  const token = pm[1].split("/").pop();
  const base = (await getText(origin + "/pass_md5/" + pm[1], { Referer: finalUrl })).trim();
  if (!/^https?:/i.test(base)) { DIAG.push("dood:badbase " + base.slice(0, 40)); return []; }
  DIAG.push("dood:ok");
  return [{
    url: base + randAlnum(10) + "?token=" + token + "&expiry=" + Date.now(),
    quality: "Direct", height: 0,
    hdrs: Object.assign({}, UA, { Referer: origin + "/" }),
  }];
}

// ---------- OK.ru ----------
async function resolveOkru(url) {
  const id = (/videoembed\/(\d+)/.exec(url) || /video\/(\d+)/.exec(url) || [])[1];
  if (!id) return [];
  const html = await getText(`https://ok.ru/videoembed/${id}`, { Referer: "https://ok.ru/" });
  const opt = /data-options="([^"]+)"/.exec(html);
  if (!opt) return [];
  const json = opt[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const meta = JSON.parse(JSON.parse(json).flashvars.metadata);
  const H = Object.assign({}, UA, { Referer: "https://ok.ru/" });
  const out = [];
  if (meta.hlsManifestUrl) (await expandHls(meta.hlsManifestUrl, H)).forEach((l) => { l.hdrs = H; out.push(l); });
  const map = { mobile: 144, lowest: 240, low: 360, sd: 480, hd: 720, full: 1080, quad: 1440, ultra: 2160 };
  (meta.videos || []).forEach((v) => {
    const h = map[v.name] || 0;
    if (v.url && h) out.push({ url: v.url, quality: qualityLabel(h), height: h, hdrs: H });
  });
  return out;
}

// ---------- generic hosts (Mp4upload, StreamWish, VidHide, Uqload, ...) ----------
async function resolveGeneric(embed, pageUrl) {
  const origin = "https://" + hostOf(embed);
  const H = Object.assign({}, UA, { Referer: pageUrl || BASE + "/" });
  const raw = await getText(embed, H);
  let html = raw;
  // unpack every packed script and append the result
  const packed = raw.match(/eval\(function\(p,a,c,k,e,[\s\S]*?\.split\('\|'\)[^)]*\)\)/g) || [];
  packed.forEach((p) => { html += "\n" + unpack(p); });
  html = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");

  const PH = Object.assign({}, UA, { Referer: /mp4upload/i.test(embed) ? "https://www.mp4upload.com/" : embed, Origin: origin });
  const out = [], seen = {};
  const push = (l) => { if (!seen[l.url]) { seen[l.url] = 1; l.hdrs = PH; out.push(l); } };
  let m;

  // 1) HLS playlists
  const re = /(?:https?:)?\/\/[^"'\s<>\\]+?\.m3u8[^"'\s<>\\]*|["']\/[^"'\s<>\\]+?\.m3u8[^"'\s<>\\]*["']/g;
  const hls = [];
  while ((m = re.exec(html))) {
    let u = m[0].replace(/^["']|["']$/g, "");
    u = absUrl(embed, u);
    if (hls.indexOf(u) < 0) hls.push(u);
  }
  for (const u of hls.slice(0, 3)) (await expandHls(u, PH)).forEach(push);

  // 2) direct files with a quality label
  const lab = (v) => { const n = parseInt(v, 10); return n ? qualityLabel(n) : String(v); };
  const pat = [
    /["']?(?:file|src|url)["']?\s*:\s*["'](https?:[^"']+\.(?:mp4|webm|m3u8)[^"']*)["']\s*,\s*["']?(?:label|res|quality|size|title)["']?\s*:\s*["']?(\d{3,4})p?["']?/gi,
    /["']?(?:label|res|quality|size)["']?\s*:\s*["']?(\d{3,4})p?["']?\s*,\s*["']?(?:file|src|url)["']?\s*:\s*["'](https?:[^"']+)["']/gi,
    /<source[^>]+src=["'](https?:[^"']+)["'][^>]*(?:size|res|label|title|data-res)=["'](\d{3,4})p?["']/gi,
    /<source[^>]+(?:size|res|label|title|data-res)=["'](\d{3,4})p?["'][^>]*src=["'](https?:[^"']+)["']/gi,
  ];
  pat.forEach((r, idx) => {
    while ((m = r.exec(html))) {
      const swap = idx === 1 || idx === 3;
      const u = swap ? m[2] : m[1], q = swap ? m[1] : m[2];
      push({ url: u, quality: lab(q), height: parseInt(q, 10) || 0 });
    }
  });

  // 3) any other direct video file (mp4upload: player.src("...mp4"))
  const mp = /https?:\/\/[^"'\s<>\\]+?\.(?:mp4|webm)(?:\?[^"'\s<>\\]*)?/g;
  while ((m = mp.exec(html))) push({ url: m[0], quality: "Direct", height: 0 });

  DIAG.push("gen " + hostOf(embed) + " len=" + raw.length + " packed=" + packed.length + " found=" + out.length);
  if (!out.length) DIAG.push("page[" + raw.replace(/\s+/g, " ").slice(0, 200) + "]");
  return out;
}

// ---------- Mediafire (direct link on the file page) ----------
async function resolveMediafire(url) {
  const html = await getText(url, { Referer: "https://www.mediafire.com/" });
  const m = /href="(https?:\/\/download[^"]*mediafire\.com\/[^"]+)"/i.exec(html) ||
    /data-scrambled-url="([A-Za-z0-9+/=]+)"/.exec(html);
  if (!m) { DIAG.push("mediafire:nolink"); return []; }
  const u = /^https?:/i.test(m[1]) ? m[1] : b64decode(m[1]);
  DIAG.push("mediafire:ok");
  return [{ url: u, quality: "Direct", height: 0, hdrs: Object.assign({}, UA, { Referer: "https://www.mediafire.com/" }) }];
}

async function resolve(server, pageUrl) {
  const u = server.url;
  let links = [];
  try {
    if (/dailymotion\.com|dai\.ly/i.test(u)) links = await resolveDailymotion(u, pageUrl);
    else if (/rumble\.com/i.test(u)) links = await resolveRumble(u, pageUrl);
    else if (/dood|d000d|ds2play|dsvplay|d0o0d|do7go/i.test(u)) links = await resolveDood(u, pageUrl);
    else if (/ok\.ru/i.test(u)) links = await resolveOkru(u);
    else if (/mediafire\.com/i.test(u)) links = await resolveMediafire(u);
    else links = await resolveGeneric(u, pageUrl);
  } catch (e) { DIAG.push(server.kind + " err " + (e && e.message)); }
  // single-quality hosts: the tab (SD/HD/FHD) on the site tells the quality
  const th = TAB_H[server.tab];
  if (th) links.forEach((l) => { if (!l.height) { l.height = th; l.quality = qualityLabel(th); } });
  return links;
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  DIAG.length = 0;
  const fail = (m) => [{ name: "WitAnime DEBUG", title: dbg.concat(m, DIAG).join(" > ").slice(0, 1200), url: "https://debug.invalid/", quality: "debug" }];
  try {
    const sNum = Number(season) || 1;
    const ep = mediaType === "tv" ? (episode || 1) : 1;
    const titles = await getTmdbTitles(tmdbId, mediaType);
    dbg.push("titles=" + titles.join("|"));
    if (!titles.length) return fail("no titles");

    const alt = await anilistTitles(titles, mediaType === "tv" ? sNum : 1);
    dbg.push("anilist=" + (alt.join("|") || "none"));

    // 1) direct: /watch/{slug}/{episode} with slugs built from romaji/english titles
    let found = null;
    for (const slug of slugCandidates(alt.concat(titles), mediaType === "tv" ? sNum : 1)) {
      found = await tryWatch(slug, ep);
      if (found) break;
    }
    // 2) fallback: site search
    if (!found) found = await findBySearch(alt.concat(titles), mediaType === "tv" ? sNum : 1, ep);
    if (!found) return fail("episode page not found");
    const pageUrl = found.url;
    const html = found.html;
    dbg.push("ep=" + pageUrl);

    const servers = extractServers(html).slice(0, 12);
    dbg.push("servers=" + servers.length + "[" + servers.map((s) => s.kind + (s.tab ? ":" + s.tab : "")).join(",") + "]");
    if (!servers.length) pageDiag(html);

    const results = await Promise.all(
      servers.map(async (s) => ({ s, links: await resolve(s, pageUrl) }))
    );
    const streams = [];
    results.forEach(({ s, links }) => {
      links.sort((a, b) => b.height - a.height);
      links.forEach((l) =>
        streams.push({
          name: "WitAnime",
          title: s.kind + (s.tab ? " " + s.tab : "") + (l.info ? " (" + l.info + ")" : ""),
          url: l.url,
          quality: l.quality,
          headers: l.hdrs || UA,
          provider: "witanime",
        })
      );
    });
    return streams.length ? streams : fail("no playable streams");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams };
