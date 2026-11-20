// WitAnime provider for Nuvio (QuickJS: no DOM, no Node APIs).

const BASE = "https://witanime.site";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

const UA_STR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CH = {
  "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};
const LANG = "ar,en-US;q=0.9,en;q=0.8";

const MAX_GATES = 5;
const GATE_DELAY_MS = 400;
const FETCH_TIMEOUT_MS = 25000;

// Watch hosts expanded with servers seen on WitAnime watch page
const SUPPORTED = ["mp4upload", "yourupload", "yonaplay", "videa"];
const DL_SUPPORTED = ["mp4upload", "mediafire"];
const TAB_H = { FHD: 1080, HD: 720, SD: 480 };

const DEBUG = (function () {
  try {
    return typeof process !== "undefined" && process.env && !!process.env.WITANIME_DEBUG;
  } catch (e) {
    return false;
  }
})();
const DIAG = [];
const sleep = (ms) => new Promise((r) => (typeof setTimeout === "function" ? setTimeout(r, ms) : r()));

function getTimeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) return AbortSignal.timeout(ms);
  } catch (e) {}
  try {
    if (typeof AbortController !== "undefined" && typeof setTimeout === "function") {
      const ctrl = new AbortController();
      setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, ms);
      return ctrl.signal;
    }
  } catch (e) {}
  return undefined;
}

// ---------- cookies ----------
let JAR = {};
function jarHeader() {
  const k = Object.keys(JAR);
  return k.length ? k.map((n) => n + "=" + JAR[n]).join("; ") : "";
}
function jarAdd(list) {
  (list || []).forEach((c) => {
    const m = /^\s*([^=;\s]+)=([^;]*)/.exec(String(c || ""));
    if (m) JAR[m[1]] = m[2];
  });
}
function jarUpdate(res) {
  try {
    if (!res || !res.headers) return;
    if (typeof res.headers.getSetCookie === "function") return jarAdd(res.headers.getSetCookie());
    const sc = typeof res.headers.get === "function" ? res.headers.get("set-cookie") : res.headers["set-cookie"];
    if (sc) jarAdd(Array.isArray(sc) ? sc : String(sc).split(/,(?=\s*[A-Za-z0-9_.\-]+=)/));
  } catch (e) {}
}

async function fx(url, opts, tries, timeoutMs) {
  tries = tries || 3;
  const ms = timeoutMs || FETCH_TIMEOUT_MS;
  let last = null;
  const own = String(url).indexOf(BASE) === 0;
  for (let i = 0; i < tries; i++) {
    try {
      const o = Object.assign({}, opts || {});
      o.headers = Object.assign({}, o.headers || {});
      const ck = own ? jarHeader() : "";
      if (ck) o.headers["Cookie"] = ck;
      const sig = getTimeoutSignal(ms);
      if (sig) o.signal = sig;
      const r = await fetch(url, o);
      if (own) jarUpdate(r);
      return r;
    } catch (e) {
      last = e;
      await sleep(500 * (i + 1));
    }
  }
  throw last || new Error("fetch failed");
}

function pageHeaders(referer, dest, site) {
  const h = Object.assign(
    {
      "User-Agent": UA_STR,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": LANG,
      "Sec-Fetch-Dest": dest || "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": site || (referer ? "same-origin" : "none"),
      "Upgrade-Insecure-Requests": "1",
    },
    CH
  );
  if (referer) h.Referer = referer;
  return h;
}

// ---------- helpers ----------
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/&#8217;|&#039;|&amp;|’|'/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();

function similarity(a, b) {
  const A = new Set(norm(a).split(" "));
  const B = new Set(norm(b).split(" "));
  let hit = 0;
  A.forEach((w) => B.has(w) && hit++);
  return hit / Math.max(A.size, B.size, 1);
}
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}
function absUrl(base, rel) {
  if (!rel) return "";
  if (/^https?:/i.test(rel)) return rel;
  if (/^\/\//.test(rel)) return "https:" + rel;
  if (rel[0] === "/") return base.replace(/^(https?:\/\/[^\/]+).*/, "$1") + rel;
  return base.replace(/[^\/]*$/, "") + rel;
}
function originOf(u) {
  const m = /^(https?:\/\/[^\/?#]+)/i.exec(u);
  return m ? m[1] : u;
}
const cleanUrl = (u) =>
  String(u || "")
    .replace(/&amp;/g, "&")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .trim();

function isPlayableMediaUrl(u) {
  const s = cleanUrl(u);
  if (!/^https?:\/\//i.test(s)) return false;
  if (/\.(zip|rar|7z|tar|gz|exe|apk|srt|vtt|ass)(?:[?#]|$)/i.test(s)) return false;
  return true;
}

function formatHostName(label) {
  const map = {
    mp4upload: "Mp4upload",
    yourupload: "YourUpload",
    yonaplay: "YonaPlay",
    videa: "Videa",
    mediafire: "Mediafire",
  };
  return map[label] || (label ? label.charAt(0).toUpperCase() + label.slice(1) : "Server");
}

function unpackOne(src, m) {
  try {
    let p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const a = parseInt(m[2], 10);
    let c = parseInt(m[3], 10);
    const k = m[4].split("|");
    const base = (n) =>
      (n < a ? "" : base(Math.floor(n / a))) +
      ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    while (c--) if (k[c]) p = p.replace(new RegExp("\\b" + base(c) + "\\b", "g"), k[c]);
    return p;
  } catch (e) {
    return "";
  }
}
function unpack(src) {
  const re = /\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/g;
  let m, out = "";
  while ((m = re.exec(src))) out += "\n" + unpackOne(src, m);
  return out;
}

// ---------- titles ----------
const ORD = { 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th" };
const ORDW = { 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth" };
function seasonRe(n) {
  return new RegExp(
    "(?:\\b" + n + "(?:st|nd|rd|th) season|season " + n + "\\b|\\b" + (ORDW[n] || "zzz") + " season|\\b" + n + "nd\\b|\\b" + n + "rd\\b|\\b" + n + "th\\b)",
    "i"
  );
}

async function getTmdbTitles(tmdbId, mediaType) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const out = [];
  for (const lang of ["en-US", "ar-SA"]) {
    try {
      const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=${lang}`;
      const r = await fx(url, {}, 2, 12000);
      const text = await r.text();
      let j;
      try {
        j = JSON.parse(text);
      } catch (parseError) {
        DIAG.push("TMDB " + lang + " HTTP " + r.status + " invalid-json len=" + text.length + " body=" + text.slice(0, 90).replace(/\s+/g, " "));
        continue;
      }
      if (r.status >= 400) {
        const reason = j && (j.status_message || j.message) || text.slice(0, 100).replace(/\s+/g, " ");
        DIAG.push("TMDB " + lang + " HTTP " + r.status + " " + reason);
        continue;
      }
      const found = [j && (j.name || j.title), j && (j.original_name || j.original_title)].filter(Boolean);
      DIAG.push("TMDB " + lang + " HTTP " + r.status + " titles=" + (found.join("/") || "none"));
      found.forEach((t) => {
        if (out.indexOf(t) < 0) out.push(t);
      });
    } catch (e) {
      DIAG.push("TMDB " + lang + " error=" + String(e && e.message || e).slice(0, 100));
    }
  }
  return out;
}
async function anilistTitles(queries, season) {
  const out = [];
  const q = "query($s:String){Page(perPage:6){media(search:$s,type:ANIME){title{romaji english} synonyms}}}";
  for (const text of queries.slice(0, 3)) {
    try {
      const r = await fx(
        "https://graphql.anilist.co",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query: q, variables: { s: text } }),
        },
        2,
        12000
      );
      const j = await r.json();
      const media = (j && j.data && j.data.Page && j.data.Page.media) || [];
      let best = null;
      media.forEach((m) => {
        const names = [m.title && m.title.romaji, m.title && m.title.english].concat(m.synonyms || []).filter(Boolean);
        let score = Math.max.apply(null, names.map((n) => similarity(text, n)).concat([0]));
        const hay = names.join(" | ");
        if (season > 1) score += seasonRe(season).test(hay) ? 0.4 : -0.2;
        else if (/\b(2nd|3rd|4th|season [2-9])\b/i.test(hay)) score -= 0.2;
        if (!best || score > best.score) best = { score, m };
      });
      if (best && best.score >= 0.5) {
        [best.m.title && best.m.title.romaji, best.m.title && best.m.title.english].forEach((t) => {
          if (t && out.indexOf(t) < 0) out.push(t);
        });
        break;
      }
    } catch (e) {
      DIAG.push("anilist err");
    }
  }
  return out;
}

const slugify = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/&#?\w+;/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

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

// ---------- site ----------
async function tryWatch(slug, episode, isMovie) {
  const url = isMovie ? `${BASE}/watch/movie/${slug}` : `${BASE}/watch/${slug}/${episode}`;
  try {
    const r = await fx(url, { headers: pageHeaders(BASE + "/") });
    const html = await r.text();
    const bad = (r.status && r.status >= 400) || html.length < 1500 || /data-status="404"/.test(html);
    DIAG.push("try " + slug + ":" + (r.status || "?") + (bad ? ":x" : ":ok"));
    return bad ? null : { url, html, slug };
  } catch (e) {
    DIAG.push("try " + slug + ":err");
    return null;
  }
}

async function search(query) {
  let html = "";
  try {
    html = await (await fx(`${BASE}/search?q=${encodeURIComponent(query)}`, { headers: pageHeaders(BASE + "/") })).text();
  } catch (e) {
    return [];
  }
  const results = [], seen = {};
  const re = /<a[^>]+href="((?:https?:\/\/[^"\/]+)?\/(?:watch|anime)\/([^"\/#?]+)[^"#?]*)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2];
    if (slug === "movie" || seen[slug]) continue;
    seen[slug] = 1;
    const t = /title="([^"]+)"/i.exec(m[0]);
    const slugTitle = safeDecode(slug).replace(/-/g, " ");
    results.push({ slug, title: t ? t[1] : slugTitle, slugTitle });
  }
  DIAG.push("search " + results.length);
  return results;
}

async function findBySearch(titles, season, episode, isMovie) {
  const queries = [];
  titles.forEach((t) => {
    if (season > 1) queries.push(`${t} ${ORD[season] || season} season`);
    queries.push(t);
  });
  let best = null;
  for (const q of queries.slice(0, 5)) {
    for (const r of await search(q)) {
      let score = Math.max(similarity(q, r.title), similarity(q, r.slugTitle));
      if (season > 1 && seasonRe(season).test(r.title + " " + r.slugTitle)) score += 0.3;
      if (!best || score > best.score) best = Object.assign({ score }, r);
    }
    if (best && best.score >= 0.8) break;
  }
  if (!best || best.score < 0.5) return null;
  DIAG.push("search-best " + best.slug);
  return await tryWatch(best.slug, episode, isMovie);
}

// ---------- sources + gates ----------
function csrfOf(html) {
  const m = /name="csrf-token"\s+content="([^"]+)"/i.exec(html);
  return m ? m[1] : "";
}

function sourcesUrlOf(page) {
  const m = /sourcesUrl\s*:\s*['"]([^'"]+)['"]/.exec(page.html);
  if (m) return absUrl(BASE + "/", m[1].replace(/\\\//g, "/"));
  return page.url + "/sources";
}

function xhrHeaders(page, csrf) {
  return Object.assign(
    {
      "User-Agent": UA_STR,
      Accept: "application/json",
      "Accept-Language": LANG,
      "X-CSRF-TOKEN": csrf,
      Origin: BASE,
      Referer: page.url,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    },
    CH
  );
}

async function getTokens(page, csrf) {
  const r = await fx(sourcesUrlOf(page), { method: "POST", headers: xhrHeaders(page, csrf), body: "" });
  const txt = await r.text();
  DIAG.push("sources:" + r.status);
  let j;
  try { j = JSON.parse(txt); } catch (e) { return []; }
  const out = [];
  const players = (j && j.players) || {};
  Object.keys(players).forEach((tab) => {
    (players[tab] || []).forEach((p) => {
      if (!p || !p.token) return;
      const label = String(p.label || "").toLowerCase();
      const pri = SUPPORTED.indexOf(label);
      if (pri < 0) return;
      out.push({ token: p.token, label, tab, version: p.version || "sub", lang: p.lang || "", pri, h: TAB_H[tab] || 0 });
    });
  });
  const dls = (j && j.downloads) || {};
  Object.keys(dls).forEach((tab) => {
    (dls[tab] || []).forEach((p) => {
      if (!p || !p.token) return;
      const label = String(p.label || "").toLowerCase();
      const pri = DL_SUPPORTED.indexOf(label);
      if (pri < 0) return;
      out.push({ token: p.token, label, tab, dl: true, version: p.version || "sub", lang: p.lang || "", pri, h: TAB_H[tab] || 0 });
    });
  });
  out.sort((a, b) =>
    (a.version === "sub" ? 0 : 1) - (b.version === "sub" ? 0 : 1) ||
    b.h - a.h ||
    (a.dl ? 1 : 0) - (b.dl ? 1 : 0) ||
    a.pri - b.pri
  );
  const seen = {};
  return out.filter((t) => {
    const k = t.label + t.tab + t.version + (t.dl ? "d" : "s");
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  });
}

function gateRaw(url, headers) {
  let https = null;
  try { if (typeof require === "function") https = require("https"); } catch (e) {}
  if (!https) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = https.request(
        { hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers: headers, timeout: 15000 },
        (res) => {
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () => {
            jarAdd([].concat(res.headers["set-cookie"] || []));
            resolve({ status: res.statusCode, location: res.headers.location || "", body });
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => resolve({ status: 0, location: "", body: "" }));
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

async function openGate(page, csrf, t) {
  const kind = t.dl ? "download" : "stream";
  const gateUrl = `${BASE}/watch/${kind}-gate/${t.token}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await sleep(800);
    let sr;
    try {
      sr = await fx(`${BASE}/watch/${kind}-source/${t.token}`, { method: "POST", headers: xhrHeaders(page, csrf), body: "" }, 2);
    } catch (e) {
      DIAG.push(t.label + " source net#" + attempt);
      continue;
    }
    if (sr.status >= 400) {
      DIAG.push(t.label + " source:" + sr.status);
      if (sr.status === 404 || sr.status === 419) return "";
      continue;
    }
    await sleep(1500);

    const gh = t.dl
      ? Object.assign({}, pageHeaders(page.url, "document", "same-origin"))
      : Object.assign({}, pageHeaders("", "iframe", "same-origin"));
    const ck = jarHeader();
    if (ck) gh["Cookie"] = ck;

    let status = 0, loc = "", body = "", via = "https";
    const raw = await gateRaw(gateUrl, gh);
    if (raw === null) {
      via = "fetch";
      try {
        const gr = await fetch(gateUrl, { redirect: "manual", headers: gh });
        jarUpdate(gr);
        status = gr.status;
        try { loc = (gr.headers && typeof gr.headers.get === "function" && gr.headers.get("location")) || ""; } catch (e) {}
        if (!loc && gr.url && gr.url !== gateUrl && /^https?:/i.test(gr.url)) loc = gr.url;
        if (!loc) body = await gr.text();
      } catch (e) {
        status = 0;
      }
    } else {
      status = raw.status;
      loc = raw.location;
      body = raw.body;
    }

    if (!loc && body) {
      const m = /url='([^']+)'|Redirecting to <a href="([^"]+)"/i.exec(body);
      if (m) loc = m[1] || m[2];
    }
    DIAG.push(t.label + " gate:" + status + "(" + via + ")" + (loc ? ":ok" : ":none") + "#" + attempt);
    if (loc) return cleanUrl(loc);
  }
  return "";
}

// ---------- host resolvers ----------
function b64decode(str) {
  if (typeof atob === "function") {
    try { return atob(String(str)); } catch (e) {}
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  str = String(str).replace(/[^A-Za-z0-9+/]/g, "");
  let out = "", bits = 0, val = 0;
  for (let i = 0; i < str.length; i++) {
    val = (val << 6) | chars.indexOf(str[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((val >> bits) & 0xff);
    }
  }
  return out;
}

async function resolveMediafire(pageUrl) {
  const r = await fx(pageUrl, { headers: { "User-Agent": UA_STR, "Accept-Language": LANG, Accept: "text/html,*/*;q=0.8" } }, 2, 25000);
  const html = await r.text();
  let url = "";
  const sc = /data-scrambled-url="([^"]+)"/i.exec(html);
  if (sc) url = b64decode(sc[1]);
  if (!/^https?:\/\//i.test(url)) {
    const m =
      /href="(https?:\/\/download[^"]*mediafire\.com[^"]+)"/i.exec(html) ||
      /id="downloadButton"[^>]*href="(https?:\/\/[^"]+)"/i.exec(html) ||
      /aria-label="Download file"[^>]*href="(https?:\/\/[^"]+)"/i.exec(html);
    url = m ? m[1] : "";
  }
  const links = url && isPlayableMediaUrl(url) ? [{ url: cleanUrl(url), quality: "" }] : [];
  return {
    links,
    headers: { "User-Agent": UA_STR },
    info: "mediafire http=" + r.status + " len=" + html.length + " scrambled=" + (sc ? "y" : "n"),
  };
}

async function expandHls(master, hdrs) {
  const out = isPlayableMediaUrl(master) ? [{ url: master, quality: "Auto" }] : [];
  try {
    const txt = await (await fx(master, { headers: hdrs }, 2)).text();
    const lines = txt.split(/\r?\n/);
    const by = {};
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      let next = "";
      for (let k = i + 1; k < lines.length; k++) {
        const s = lines[k].trim();
        if (s && s[0] !== "#") { next = s; break; }
      }
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
      if (!next || !res) continue;
      const h = Math.max(parseInt(res[2], 10), Math.round((parseInt(res[1], 10) * 9) / 16));
      const full = absUrl(master, next);
      if (isPlayableMediaUrl(full)) by[h] = full;
    }
    Object.keys(by)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach((h) => out.push({ url: by[h], quality: h + "p" }));
  } catch (e) {}
  return out;
}

async function resolveEmbed(embedUrl, referers, dumpName) {
  const origin = originOf(embedUrl);
  const refList = referers && referers.length ? referers : [origin + "/"];
  let html = "", status = 0, usedRef = "";
  for (const ref of refList) {
    try {
      const r = await fx(embedUrl, { headers: { "User-Agent": UA_STR, Referer: ref, "Accept-Language": LANG, Accept: "text/html,*/*;q=0.8" } }, 2);
      status = r.status;
      html = await r.text();
      usedRef = ref;
      if (status < 400 && html.length > 300) break;
    } catch (e) {
      status = 0;
    }
  }
  const unp = unpack(html);
  const text = cleanUrl(html + "\n" + unp);
  if (DEBUG && dumpName) {
    try { require("fs").writeFileSync(dumpName, html + "\n\n/* ---- UNPACKED ---- */\n" + unp); } catch (e) {}
  }
  const found = [], seen = {};
  const add = (u) => {
    u = cleanUrl(u);
    if (u && isPlayableMediaUrl(u) && !seen[u]) {
      seen[u] = 1;
      found.push(u);
    }
  };
  let m;
  const re = /["'(=:\s](https?:\/\/[^"'\s<>\\)]+\.(?:m3u8|mp4)(?![A-Za-z0-9_])(?:\?[^"'\s<>\\)]*)?)/gi;
  while ((m = re.exec(text))) add(m[1]);
  const kv = /["']?(?:hls\d*|file|source|src|stream|url)["']?\s*[:=]\s*["']([^"']+)["']/gi;
  while ((m = kv.exec(text))) {
    const v = m[1];
    if (/^(?:https?:)?\/\//i.test(v) || v[0] === "/") {
      if (/\.(?:m3u8|mp4)(?![A-Za-z0-9_])|\/stream\/|master|index|playlist/i.test(v)) add(absUrl(embedUrl, v));
    }
  }
  const rel = /["'](\/[^"'\s]+\.m3u8[^"'\s]*)["']/gi;
  while ((m = rel.exec(text))) add(absUrl(embedUrl, m[1]));
  const play = { "User-Agent": UA_STR, Referer: origin + "/" };
  const links = [];
  for (const u of found.slice(0, 4)) {
    if (/\.m3u8|\/stream\/|master|playlist/i.test(u) && !/\.mp4(?![A-Za-z0-9_])/i.test(u)) {
      (await expandHls(u, play)).forEach((l) => links.push(l));
    } else {
      links.push({ url: u, quality: "" });
    }
  }
  const info =
    "embed=" + origin.replace(/^https?:\/\//, "") +
    " http=" + status +
    " len=" + html.length +
    " packed=" + (unp ? "y" : "n") +
    " found=" + found.length +
    (usedRef ? " ref=" + originOf(usedRef).replace(/^https?:\/\//, "") : "");
  return { links, headers: play, info };
}

// ---------- main ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  DIAG.length = 0;
  DIAG.push("input id=" + String(tmdbId) + " media=" + String(mediaType));
  JAR = {};
  season = Number(season) || 1;
  episode = Number(episode) || 1;
  const isMovie = mediaType === "movie";
  const streams = [];

  // Temporary Nuvio diagnostic: return a visible result instead of silently
  // returning an empty array. Its title contains the failure stage and trace.
  const fail = (msg) => {
    const trace = DIAG.join(" > ");
    const detail = ("WitAnime DEBUG | " + msg + (trace ? " | " + trace : "")).slice(0, 500);
    try { console.log(detail); } catch (e) {}
    return [{
      name: detail,
      title: detail,
      url: "https://debug.invalid/",
      // Nuvio renders quality as the stream subtitle; put the diagnostic there.
      quality: detail,
    }];
  };

  try {
    let page = null;
    let all = [];
    if (String(tmdbId).indexOf("slug:") === 0) {
      page = await tryWatch(String(tmdbId).slice(5), episode, isMovie);
    } else {
      const titles = await getTmdbTitles(tmdbId, mediaType);
      const romaji = await anilistTitles(titles, season);
      all = romaji.concat(titles.filter((t) => romaji.indexOf(t) < 0));
      DIAG.push("titles=" + all.join("|"));
      for (const slug of slugCandidates(all, season)) {
        page = await tryWatch(slug, episode, isMovie);
        if (page) break;
      }
    }
    if (!page && all.length) page = await findBySearch(all, season, episode, isMovie);
    if (!page) return fail("episode page not found");

    const csrf = csrfOf(page.html);
    if (!csrf) return fail("no csrf token");
    const tokens = await getTokens(page, csrf);
    if (!tokens.length) return fail("no supported servers");

    let opened = 0;
    for (const t of tokens) {
      if (opened >= MAX_GATES || streams.length >= 6) break;
      if (opened) await sleep(GATE_DELAY_MS);
      opened++;
      try {
        const embed = await openGate(page, csrf, t);
        if (!embed) continue;
        DIAG.push(t.label + (t.dl ? " dl " : " ") + t.tab + " url=" + embed.slice(0, 100));
        let res;
        if (t.label === "mediafire") {
          res = await resolveMediafire(embed);
        } else {
          let eu = embed;
          if (t.label === "mp4upload" && !/\/embed-/.test(eu)) {
            const idm = /mp4upload\.com\/(?:embed-)?([A-Za-z0-9]+)/.exec(eu);
            if (idm) eu = "https://www.mp4upload.com/embed-" + idm[1] + ".html";
          }
          res = await resolveEmbed(eu, ["", BASE + "/"], DEBUG ? "wit_" + t.label + "_" + t.tab + (t.dl ? "_dl" : "") + ".html" : "");
        }
        DIAG.push(t.label + " " + res.info + " links:" + res.links.length);
        const host = formatHostName(t.label);
        res.links.forEach((l) => {
          if (!isPlayableMediaUrl(l.url)) return;
          streams.push({
            name: "WitAnime - " + host,
            title: host + " " + t.tab + (t.dl ? " dl" : "") + " (" + t.version + ")",
            url: l.url,
            quality: l.quality || (t.h ? t.h + "p" : "auto"),
            headers: res.headers,
          });
        });
      } catch (e) {
        DIAG.push(t.label + " err " + (e && e.message));
      }
    }
    if (DEBUG) {
      try { console.log("DIAG:\n  " + DIAG.join("\n  ")); } catch (e) {}
    }
    if (!streams.length) return fail("no playable links");
    streams.sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));
    return streams;
  } catch (e) {
    return fail("error " + (e && e.message));
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
