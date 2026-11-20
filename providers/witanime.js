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
  { key: "Dailymotion", re: /dailymotion\.com|dai\.ly/i },
  { key: "Rumble", re: /rumble\.com/i },
  { key: "Dood", re: /dood|d000d|ds2play|dsvplay|d0o0d|do7go/i },
  { key: "Mp4upload", re: /mp4upload\.com/i },
  { key: "OK.ru", re: /ok\.ru/i },
  { key: "StreamWish", re: /streamwish|wishfast|awish|hlswish|swhoi|sfastwish|strwish/i },
  { key: "VidHide", re: /vidhide|filelions|vidhidepro|ahvsh|dhcplay/i },
  { key: "Uqload", re: /uqload/i },
  { key: "YourUpload", re: /yourupload\.com/i },
  { key: "Videa", re: /videa\.hu/i },
  { key: "Voe", re: /voe\.sx|voe-/i },
  { key: "Streamtape", re: /streamtape|strtape|stape/i },
  { key: "Mixdrop", re: /mixdrop|mxdrop/i },
  { key: "Sibnet", re: /sibnet\.ru/i },
];
const SKIP = /(histats|google|gstatic|facebook|twitter|t\.me|whatsapp|gravatar|wp-content|wp-json|wp-includes|disqus|cloudflare|jquery|bootstrap|fontawesome|schema\.org|w3\.org|youtube\.com\/(?:channel|c\/|@)|instagram|tiktok|discord|telegram|mega\.nz|drive\.google|mediafire|1fichier|\.(?:png|jpe?g|gif|webp|svg|ico|css|js|woff2?|ttf)(?:\?|$))/i;

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

// ---------- TMDB ----------
async function getTitles(tmdbId, mediaType) {
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

// ---------- site ----------
async function search(query) {
  const html = await getText(`${BASE}/?search_param=animes&s=${encodeURIComponent(query)}`);
  const results = [], seen = {};
  const re = /<a[^>]+href="((?:https?:\/\/[^"\/]+)?\/anime\/[^"#?]+?\/?)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = absUrl(BASE + "/", m[1]).replace(/\/?$/, "/");
    if (seen[url]) continue;
    seen[url] = 1;
    const tag = m[0];
    const t = /title="([^"]+)"/i.exec(tag);
    const slugTitle = safeDecode(url.replace(/.*\/anime\//, "").replace(/\/$/, "")).replace(/-/g, " ");
    results.push({ url, title: t ? t[1] : slugTitle, slugTitle });
  }
  return results;
}

async function findSeries(titles, mediaType, season) {
  const queries = [];
  titles.forEach((t) => {
    if (mediaType === "tv" && season > 1) queries.push(`${t} season ${season}`);
    queries.push(t);
  });
  let best = null;
  for (const q of queries) {
    const res = await search(q);
    for (const r of res) {
      let score = Math.max(similarity(q, r.title), similarity(q, r.slugTitle));
      if (mediaType === "tv" && season > 1 && new RegExp(`(season|الموسم)[ -]*${season}\\b`, "i").test(r.title + " " + r.slugTitle)) score += 0.3;
      if (!best || score > best.score) best = Object.assign({ score }, r);
    }
    if (best && best.score >= 0.8) break;
  }
  return best && best.score >= 0.5 ? best : null;
}

// Episode links look like: /episode/{slug}-الحلقة-12/  (URL-encoded Arabic)
function episodeNumber(url) {
  const s = safeDecode(url);
  const m = /(?:الحلقة|episode|ep)[-_ ]*(\d+)/i.exec(s);
  return m ? parseInt(m[1], 10) : null;
}

async function findEpisodeUrl(seriesUrl, episode) {
  const html = await getText(seriesUrl);
  const re = /href="((?:https?:\/\/[^"\/]+)?\/episode\/[^"#?]+?\/?)"/gi;
  const links = [], seen = {};
  let m;
  while ((m = re.exec(html))) {
    const u = absUrl(BASE + "/", m[1]);
    if (!seen[u]) { seen[u] = 1; links.push(u); }
  }
  DIAG.push("eplinks=" + links.length);
  const ep = Number(episode);
  for (const u of links) if (episodeNumber(u) === ep) return u;
  // Fallback: list is paginated/lazy -> rewrite the number in a sibling link.
  const sample = links.find((u) => episodeNumber(u) !== null);
  if (sample) {
    const guess = safeDecode(sample).replace(/((?:الحلقة|episode|ep)[-_ ]*)\d+/i, "$1" + ep);
    DIAG.push("epguess");
    return encodeURI(guess);
  }
  return null;
}

async function findMovieUrl(seriesUrl) {
  const html = await getText(seriesUrl);
  const m = /href="((?:https?:\/\/[^"\/]+)?\/episode\/[^"#?]+?\/?)"/i.exec(html);
  return m ? absUrl(BASE + "/", m[1]) : seriesUrl;
}

// ---------- server discovery ----------
function cleanUrl(u) {
  return String(u).replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/^\/\//, "https://").trim();
}

function kindOf(url) {
  for (let i = 0; i < PRIORITY.length; i++) if (PRIORITY[i].re.test(url)) return { key: PRIORITY[i].key, prio: i };
  return { key: hostOf(url).replace(/^www\./, ""), prio: PRIORITY.length };
}

function extractServers(html) {
  const out = [], seen = {};
  const add = (u) => {
    u = cleanUrl(u);
    if (!/^https?:\/\//i.test(u)) return;
    if (u.indexOf(hostOf(BASE)) >= 0 && !/embed|player/i.test(u)) return; // site's own pages
    if (SKIP.test(u)) return;
    if (seen[u]) return;
    seen[u] = 1;
    const k = kindOf(u);
    if (ONLY_PRIORITY_HOSTS && k.prio >= PRIORITY.length) return;
    out.push({ url: u, kind: k.key, prio: k.prio });
  };
  let m;

  // 1) iframes (also lazy ones)
  const ifr = /<iframe[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi;
  while ((m = ifr.exec(html))) add(m[1]);

  // 2) data-* attributes holding an URL (server buttons)
  const du = /data-[\w-]*(?:url|src|embed|link|video|server)[\w-]*=["']((?:https?:)?\/\/[^"']+)["']/gi;
  while ((m = du.exec(html))) add(m[1]);

  // 3) URLs of known hosts anywhere in the page (scripts / JSON)
  const kh = /https?:\\?\/\\?\/[^"'\s<>\\]+/g;
  while ((m = kh.exec(html))) {
    const u = cleanUrl(m[0]);
    if (PRIORITY.some((p) => p.re.test(u))) add(u);
  }

  // 4) base64 blobs (value=, data-*=, JS strings): decode, then scan for URLs / iframes.
  const blob = /["']([A-Za-z0-9+/_\-]{40,}={0,2})["']/g;
  let n = 0;
  while ((m = blob.exec(html)) && n < 60) {
    n++;
    let d = b64decode(m[1]);
    if (!/https?:|<iframe|\\\//i.test(d)) {
      // some themes reverse the string before encoding
      const rev = b64decode(m[1].split("").reverse().join(""));
      if (/https?:|<iframe/i.test(rev)) d = rev; else continue;
    }
    d = safeDecode(d);
    const f = /<iframe[^>]+src=["']([^"']+)["']/gi;
    let x;
    while ((x = f.exec(d))) add(x[1]);
    const u = /https?:\\?\/\\?\/[^"'\s<>\\]+/g;
    while ((x = u.exec(d))) add(x[0]);
  }

  out.sort((a, b) => a.prio - b.prio);
  return out;
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

  const PH = Object.assign({}, UA, { Referer: embed, Origin: origin });
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

async function resolve(server, pageUrl) {
  const u = server.url;
  try {
    if (/dailymotion\.com|dai\.ly/i.test(u)) return await resolveDailymotion(u, pageUrl);
    if (/rumble\.com/i.test(u)) return await resolveRumble(u, pageUrl);
    if (PRIORITY[2].re.test(u)) return await resolveDood(u, pageUrl);
    if (/ok\.ru/i.test(u)) return await resolveOkru(u);
    return await resolveGeneric(u, pageUrl);
  } catch (e) { DIAG.push(server.kind + " err " + (e && e.message)); }
  return [];
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  DIAG.length = 0;
  const fail = (m) => [{ name: "WitAnime DEBUG", title: dbg.concat(m, DIAG).join(" > ").slice(0, 1200), url: "https://debug.invalid/", quality: "debug" }];
  try {
    const titles = await getTitles(tmdbId, mediaType);
    dbg.push("titles=" + titles.join("|"));
    if (!titles.length) return fail("no titles");
    const series = await findSeries(titles, mediaType, Number(season) || 1);
    dbg.push("series=" + (series ? series.url : "none"));
    if (!series) return fail("series not found");

    const pageUrl = mediaType === "tv"
      ? await findEpisodeUrl(series.url, episode || 1)
      : await findMovieUrl(series.url);
    dbg.push("ep=" + pageUrl);
    if (!pageUrl) return fail("episode not found");

    const html = await getText(pageUrl);
    const servers = extractServers(html).slice(0, 8);
    dbg.push("servers=" + servers.length + "[" + servers.map((s) => s.kind).join(",") + "]");
    if (!servers.length) dbg.push("html=" + html.length);

    const results = await Promise.all(
      servers.map(async (s) => ({ s, links: await resolve(s, pageUrl) }))
    );
    const streams = [];
    results.forEach(({ s, links }) => {
      links.sort((a, b) => b.height - a.height);
      links.forEach((l) =>
        streams.push({
          name: "WitAnime",
          title: s.kind + (l.info ? " (" + l.info + ")" : ""),
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
