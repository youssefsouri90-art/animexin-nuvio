// WitAnime provider for Nuvio (QuickJS: supports TMDB and Nuvio Kitsu IDs).

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

const MAX_GATES = 16;
const GATE_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 15000;

// Prefer Videa, the server most frequently used on the current WitAnime pages.
// WitAnime returns this list dynamically. Do not hard-code only a few hosts.
// Unknown hosts use the generic embed resolver below.
const SUPPORTED = null;
const DL_SUPPORTED = null;
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
    videas: "Videas",
    videasfr: "VideasFr",
    mediafire: "Mediafire",
    hgcloud: "HGCloud",
    streamhg: "StreamHG",
    dotplay: "DotPlay",
    okru: "OkRu",
    fourshared: "FourShared",
    gofile: "GoFile",
    workupload: "WorkUpload",
    mailru: "MailRu",
    mega: "MegaNz",
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

async function getContentTitles(contentId, mediaType) {
  const rawId = String(contentId || "").trim();
  const kitsuMatch = /^kitsu:(\d+)/i.exec(rawId);

  // Nuvio can pass anime IDs in the form "kitsu:<animeId>:<episode>".
  // The first number is the Kitsu anime ID; it is not a TMDB ID.
  if (kitsuMatch) {
    const kitsuId = kitsuMatch[1];
    try {
      const r = await fx(
        `https://kitsu.io/api/edge/anime/${encodeURIComponent(kitsuId)}`,
        { headers: { Accept: "application/vnd.api+json" } },
        2,
        9000
      );
      const j = await r.json();
      const attrs = j && j.data && j.data.attributes;
      const titles = (attrs && attrs.titles) || {};
      const out = [
        attrs && attrs.canonicalTitle,
        titles.en,
        titles.en_jp,
        titles.ja_jp,
      ].filter(Boolean);
      const unique = out.filter((t, i) => out.indexOf(t) === i);
      if (r.status >= 400 || !unique.length) {
        DIAG.push("kitsu " + kitsuId + ":" + r.status + ":no titles");
      } else {
        DIAG.push("kitsu " + kitsuId + ":" + r.status + ":" + unique.slice(0, 3).join("|"));
      }
      return unique;
    } catch (e) {
      DIAG.push("kitsu " + kitsuId + ":err " + String(e && e.message || e).slice(0, 80));
      return [];
    }
  }

  // Numeric and ordinary TMDB IDs continue through the existing TMDB path.
  const type = mediaType === "movie" ? "movie" : "tv";
  const out = [];
  const results = await Promise.all(["en-US", "ar-SA"].map(async (lang) => {
    try {
      const r = await fx(`https://api.themoviedb.org/3/${type}/${encodeURIComponent(rawId)}?api_key=${TMDB_KEY}&language=${lang}`, {}, 1, 9000);
      return r.status < 400 ? await r.json() : null;
    } catch (e) { return null; }
  }));
  results.forEach((j) => {
    [j && (j.name || j.title), j && (j.original_name || j.original_title)].forEach((t) => {
      if (t && out.indexOf(t) < 0) out.push(t);
    });
  });
  return out;
}

async function anilistTitles(queries, season) {
  const q = "query($s:String){Page(perPage:6){media(search:$s,type:ANIME){title{romaji english} synonyms}}}";
  const matches = await Promise.all(queries.slice(0, 3).map(async (text) => {
    try {
      const r = await fx(
        "https://graphql.anilist.co",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query: q, variables: { s: text } }),
        },
        1,
        9000
      );
      if (r.status >= 400) return null;
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
      return best;
    } catch (e) {
      DIAG.push("anilist err");
      return null;
    }
  }));
  let best = null;
  matches.forEach((m) => { if (m && (!best || m.score > best.score)) best = m; });
  if (!best || best.score < 0.5) return [];
  return [best.m.title && best.m.title.romaji, best.m.title && best.m.title.english].filter(Boolean);
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

async function trySlugCandidates(slugs, episode, isMovie) {
  // Probe a few likely slugs together instead of waiting on each miss serially.
  for (let i = 0; i < slugs.length; i += 4) {
    const batch = slugs.slice(i, i + 4);
    const pages = await Promise.all(batch.map((slug) => tryWatch(slug, episode, isMovie)));
    for (let j = 0; j < pages.length; j++) if (pages[j]) return pages[j];
  }
  return null;
}

// ---------- site ----------
async function tryWatch(slug, episode, isMovie) {
  const url = isMovie ? `${BASE}/watch/movie/${slug}` : `${BASE}/watch/${slug}/${episode}`;
  try {
    const r = await fx(url, { headers: pageHeaders(BASE + "/") }, 1, 10000);
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
    html = await (await fx(`${BASE}/search?q=${encodeURIComponent(query)}`, { headers: pageHeaders(BASE + "/") }, 1, 10000)).text();
  } catch (e) {
    return [];
  }
  const results = [], seen = {};
  // Keep the resource kind so movie search results cannot be used for series.
  const re = /<a[^>]+href="((?:https?:\/\/[^"\/]+)?\/(watch|anime|movie)\/([^"\/#?]+)(?:\/([^"#?]*))?[^\"]*)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    let kind = String(m[2] || "").toLowerCase();
    let slug = m[3] || "";
    if (kind === "watch" && slug === "movie") {
      kind = "movie";
      slug = String(m[4] || "").split("/")[0];
    }
    if (!slug) continue;
    const key = kind + ":" + slug;
    if (seen[key]) continue;
    seen[key] = 1;
    const t = /title="([^"]+)"/i.exec(m[0]);
    const slugTitle = safeDecode(slug).replace(/-/g, " ");
    results.push({ slug, kind, title: t ? t[1] : slugTitle, slugTitle });
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
  const uniqueQueries = queries.filter((q, i) => queries.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i).slice(0, 3);
  let best = null;
  for (let i = 0; i < uniqueQueries.length; i += 3) {
    const batch = uniqueQueries.slice(i, i + 3);
    const resultSets = await Promise.all(batch.map((q) => search(q)));
    resultSets.forEach((results, n) => {
      const q = batch[n];
      for (const r of results) {
        if (isMovie ? r.kind !== "movie" : r.kind === "movie") continue;
        let score = Math.max(similarity(q, r.title), similarity(q, r.slugTitle));
        if (season > 1 && seasonRe(season).test(r.title + " " + r.slugTitle)) score += 0.3;
        if (!best || score > best.score) best = Object.assign({ score }, r);
      }
    });
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
  const out = [];
  let activeCsrf = csrf || csrfOf(page.html);
  // WitAnime sometimes returns a partial source list; retry once when Videa is absent.
  for (let attempt = 1; attempt <= 2; attempt++) {
    let r = null, j = null;
    try {
      r = await fx(sourcesUrlOf(page), { method: "POST", headers: xhrHeaders(page, activeCsrf), body: "" }, 1, 12000);
      const txt = await r.text();
      DIAG.push("sources#" + attempt + ":" + r.status);
      try { j = JSON.parse(txt); } catch (e) {}
    } catch (e) {
      DIAG.push("sources#" + attempt + ":net");
    }

    // A CSRF/session mismatch can be temporary. Refresh the watch page once before retrying.
    if (r && r.status === 419 && attempt === 1) {
      try {
        const fresh = await fx(page.url, { headers: pageHeaders(BASE + "/") }, 1, 12000);
        if (fresh.status < 400) {
          page.html = await fresh.text();
          activeCsrf = csrfOf(page.html) || activeCsrf;
          page.csrf = activeCsrf;
        }
      } catch (e) {}
    }

    const players = (j && j.players) || {};
    Object.keys(players).forEach((tab) => {
      (players[tab] || []).forEach((p) => {
        if (!p || !p.token) return;
        const label = String(p.label || "").toLowerCase();
        const pri = SUPPORTED ? SUPPORTED.indexOf(label) : 0;
        if (pri < 0) return;
        out.push({ token: p.token, label, tab, version: p.version || "sub", lang: p.lang || "", pri, h: TAB_H[tab] || 0 });
      });
    });
    const dls = (j && j.downloads) || {};
    Object.keys(dls).forEach((tab) => {
      (dls[tab] || []).forEach((p) => {
        if (!p || !p.token) return;
        const label = String(p.label || "").toLowerCase();
        const pri = DL_SUPPORTED ? DL_SUPPORTED.indexOf(label) : 0;
        if (pri < 0) return;
        out.push({ token: p.token, label, tab, dl: true, version: p.version || "sub", lang: p.lang || "", pri, h: TAB_H[tab] || 0 });
      });
    });
    if (out.length || attempt === 2) break;
    await sleep(250);
  }
  page.csrf = activeCsrf;
  out.sort((a, b) =>
    (a.version === "sub" ? 0 : 1) - (b.version === "sub" ? 0 : 1) ||
    (a.dl ? 1 : 0) - (b.dl ? 1 : 0) ||
    a.pri - b.pri ||
    b.h - a.h
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
        { hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers: headers, timeout: 9000 },
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
  let activeCsrf = page.csrf || csrf;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await sleep(350);
    let sr;
    try {
      sr = await fx(`${BASE}/watch/${kind}-source/${t.token}`, { method: "POST", headers: xhrHeaders(page, activeCsrf), body: "" }, 1, 9000);
    } catch (e) {
      DIAG.push(t.label + " source net#" + attempt);
      continue;
    }
    if (sr.status >= 400) {
      DIAG.push(t.label + " source:" + sr.status);
      if (sr.status === 419 && attempt === 1) {
        try {
          const fresh = await fx(page.url, { headers: pageHeaders(BASE + "/") }, 1, 12000);
          if (fresh.status < 400) {
            page.html = await fresh.text();
            activeCsrf = csrfOf(page.html) || activeCsrf;
            page.csrf = activeCsrf;
          }
        } catch (e) {}
      }
      if ((sr.status === 404 || sr.status === 419) && attempt === 2) return "";
      continue;
    }
    await sleep(attempt === 1 ? 250 : 500);

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
    // The master playlist itself is already playable; don't block the provider on slow variant discovery.
    const txt = await (await fx(master, { headers: hdrs }, 1, 6000)).text();
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


function cloudstreamProvider(label, embedUrl) {
  const x = String(label || "").toLowerCase().replace(/[._ -]/g, "");
  const h = String(embedUrl || "").toLowerCase();
  if (x === "videas" || x === "videasfr" || /vide[ae]as?\.(com|fr)/.test(h)) return x === "videasfr" ? "videasfr" : "videas";
  if (x === "hgcloud" || x === "streamhg" || /(?:hgcloud|streamhg|vibuxer|hanerix|dintezuvio|cavanhabg)\./.test(h)) return "hgcloud";
  if (x === "dotplay" || /dotplay\./.test(h)) return "dotplay";
  if (x === "okru" || /(?:ok\.ru|odnoklassniki\.)/.test(h)) return "okru";
  if (x === "fourshared" || /4shared\./.test(h)) return "fourshared";
  if (x === "gofile" || /gofile\./.test(h)) return "gofile";
  if (x === "workupload" || /workupload\./.test(h)) return "workupload";
  if (x === "mailru" || /(?:my\.mail\.ru|cloud\.mail\.ru|mycdn\.me)/.test(h)) return "mailru";
  if (x === "mega" || /mega\.nz/.test(h)) return "mega";
  return x;
}

function addJsonMediaUrls(value, baseUrl, add, depth) {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    const v = cleanUrl(value).replace(/\\u0026/g, "&");
    if (/^(?:https?:)?\/\//i.test(v)) add(absUrl(baseUrl, v));
    else if (/^\//.test(v) && /(?:m3u8|mp4|playlist|stream|video|download)/i.test(v)) add(absUrl(baseUrl, v));
    return;
  }
  if (Array.isArray(value)) { value.forEach((x) => addJsonMediaUrls(x, baseUrl, add, depth + 1)); return; }
  if (typeof value === "object") Object.keys(value).forEach((k) => addJsonMediaUrls(value[k], baseUrl, add, depth + 1));
}

async function resolveCloudstreamHost(label, embedUrl, pageRef) {
  const provider = cloudstreamProvider(label, embedUrl);
  // OK.ru stores playable variants in data-options/options JSON rather than
  // always exposing a visible .m3u8 URL in the HTML.
  if (provider === "okru") {
    try {
      const r = await fx(embedUrl, { headers: { "User-Agent": UA_STR, Referer: pageRef || BASE + "/", Accept: "text/html,*/*" } }, 1, 9000);
      const html = await r.text();
      const urls = [], seen = {};
      const add = (u) => { u = cleanUrl(u); if (isPlayableMediaUrl(u) && !seen[u]) { seen[u] = 1; urls.push(u); } };
      let m;
      const jsonRe = /(?:data-options|data-player-options|options)\s*=\s*["']([^"']+)["']/gi;
      while ((m = jsonRe.exec(html))) {
        try { addJsonMediaUrls(JSON.parse(xmlUnescape(m[1]).replace(/&quot;/g, '"')), embedUrl, add, 0); } catch (e) {}
      }
      const text = cleanUrl(html).replace(/\\u0022/g, '"').replace(/\\u003A/gi, ':');
      const directRe = /https?:\/\/[^"'\s<>\\]+(?:m3u8|mp4)[^"'\s<>\\]*/gi;
      while ((m = directRe.exec(text))) add(m[0]);
      if (urls.length) return { links: urls.map((u) => ({ url: u, quality: /m3u8/i.test(u) ? "Auto" : "" })), headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "okru json links=" + urls.length };
    } catch (e) {}
  }
  // These providers are represented by dedicated Cloudstream extractors, but
  // their successful responses commonly contain HLS/MP4 in JSON or scripts.
  // Feed the expanded generic parser first; it also handles URL-encoded JSON.
  return resolveEmbed(embedUrl, [pageRef || "", BASE + "/"], DEBUG ? "wit_" + provider + ".html" : "");
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
  const rel = /["'](\/[^"'\s]+(?:\.m3u8|\.mp4|\/stream\/|playlist|master)[^"'\s]*)["']/gi;
  while ((m = rel.exec(text))) add(absUrl(embedUrl, m[1]));
  // Cloudstream's extractors also walk nested JSON objects. Do the same for
  // providers such as OkRu, MailRu, GoFile and Videas.
  const jsonBlocks = text.match(/\{[\s\S]{0,200000}\}/g) || [];
  jsonBlocks.slice(0, 20).forEach((block) => {
    try { addJsonMediaUrls(JSON.parse(block), embedUrl, add, 0); } catch (e) {}
  });
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

function xmlUnescape(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function xmlAttr(attrs, name) {
  const re = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i");
  const m = re.exec(attrs || "");
  return m ? xmlUnescape(m[2]) : "";
}

function rc4Decode(cipher, key) {
  const k = String(key || "");
  if (!k) return "";
  const S = [];
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + k.charCodeAt(i % k.length)) % 256;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  let i = 0; j = 0; let out = "";
  for (let n = 0; n < cipher.length; n++) {
    i = (i + 1) % 256;
    j = (j + S[i]) % 256;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out += String.fromCharCode(cipher.charCodeAt(n) ^ S[(S[i] + S[j]) % 256]);
  }
  return out;
}

async function resolveVideaOnce(embedUrl, pageRef) {
  const headers = {
    "User-Agent": UA_STR,
    Referer: pageRef || BASE + "/",
    "Accept-Language": LANG,
    Accept: "text/html,*/*;q=0.8",
  };
  const player = await fx(embedUrl, { headers }, 1, 10000);
  const page = await player.text();
  const nonceMatch = /_xt\s*=\s*["']([^"']+)["']/i.exec(page);
  if (player.status >= 400 || !nonceMatch) {
    return { links: [], headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "videa player=" + player.status + " nonce=" + (nonceMatch ? "y" : "n") };
  }

  const secret = "xHb0ZvME5q8CBcoQi6AngerDu3FGO9fkUlwPmLVY_RTzj2hJIS4NasXWKy1td7p";
  const nonce = nonceMatch[1];
  const left = nonce.slice(0, 32), right = nonce.slice(32);
  let token = "";
  for (let n = 0; n < 32; n++) {
    const pos = secret.indexOf(left.charAt(n));
    if (pos < 0) return { links: [], headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "videa bad nonce" };
    let idx = n - (pos - 31);
    if (idx < 0) idx += right.length;
    if (idx < 0 || idx >= right.length) return { links: [], headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "videa nonce index" };
    token += right.charAt(idx);
  }

  const parts = String(embedUrl).split("?");
  const rawQuery = (parts[1] || "").split("#")[0].replace(/(^|&)_s=[^&]*/g, "").replace(/(^|&)_t=[^&]*/g, "").replace(/^&+|&+$/g, "");
  let seed = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let n = 0; n < 8; n++) seed += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  const q = (rawQuery ? rawQuery + "&" : "") + "_s=" + encodeURIComponent(seed) + "&_t=" + encodeURIComponent(token.slice(0, 16));
  const apiUrl = originOf(embedUrl) + "/player/xml?" + q;
  let response, body = "";
  try {
    response = await fx(apiUrl, { headers: Object.assign({}, headers, { Referer: embedUrl, Accept: "*/*" }) }, 1, 10000);
    body = await response.text();
  } catch (e) {
    return { links: [], headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "videa xml network" };
  }

  let xml = body.trim();
  if (xml.indexOf("<videa_video") < 0 && xml.indexOf("<?xml") < 0) {
    let xs = "";
    try { xs = response.headers && typeof response.headers.get === "function" ? (response.headers.get("x-videa-xs") || "") : ""; } catch (e) {}
    if (!xs) return { links: [], headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "videa xml=" + response.status + " no xs" };
    xml = rc4Decode(b64decode(body), token.slice(16) + seed + xs);
  }
  const err = /<error\b[^>]*>([\s\S]*?)<\/error>/i.exec(xml);
  if (err) {
    const deleted = /t.r.lt|deleted|not found/i.test(xmlUnescape(err[1]));
    return { links: [], headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "videa xml=" + response.status + (deleted ? " deleted" : " error") };
  }
  if (xml.indexOf("<videa_video") < 0) {
    return { links: [], headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "videa xml=" + response.status + " invalid" };
  }

  const hashes = {};
  const hashRe = /<hash_value_([^>]+)>([\s\S]*?)<\/hash_value_\1>/gi;
  let hm;
  while ((hm = hashRe.exec(xml))) hashes[hm[1]] = xmlUnescape(hm[2].trim());

  const playHeaders = { "User-Agent": UA_STR, Referer: originOf(embedUrl) + "/" };
  const links = [];
  const srcRe = /<video_source\b([^>]*)>([\s\S]*?)<\/video_source>/gi;
  let sm;
  while ((sm = srcRe.exec(xml))) {
    const name = xmlAttr(sm[1], "name");
    let url = xmlUnescape(sm[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
    if (!url || !name) continue;
    if (url.indexOf("//") === 0) url = "https:" + url;
    else if (url[0] === "/") url = originOf(embedUrl) + url;
    const expiry = xmlAttr(sm[1], "exp");
    if (hashes[name] && expiry) url += (url.indexOf("?") >= 0 ? "&" : "?") + "md5=" + encodeURIComponent(hashes[name]) + "&expires=" + encodeURIComponent(expiry);
    if (!isPlayableMediaUrl(url)) continue;
    const height = parseInt(xmlAttr(sm[1], "height"), 10) || 0;
    if (/\.m3u8(?:[?#]|$)/i.test(url)) {
      const expanded = await expandHls(url, playHeaders);
      if (expanded.length) expanded.forEach((l) => links.push(l));
      else links.push({ url, quality: height ? height + "p" : "Auto" });
    } else {
      links.push({ url, quality: height ? height + "p" : "" });
    }
  }
  links.sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));
  return { links, headers: playHeaders, info: "videa xml=" + response.status + " sources=" + links.length };
}

async function resolveVidea(embedUrl, pageRef) {
  let last = { links: [], headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "videa unresolved" };
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await sleep(500);
    try {
      last = await resolveVideaOnce(embedUrl, pageRef);
    } catch (e) {
      last = { links: [], headers: { "User-Agent": UA_STR, Referer: embedUrl }, info: "videa network error" };
    }
    DIAG.push("videa try#" + attempt + ":" + last.info);
    if (last.links.length || /deleted/.test(last.info)) break;
  }
  return last;
}

// ---------- main ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  DIAG.length = 0;
  JAR = {};
  season = Number(season) || 1;
  episode = Number(episode) || 1;
  const isMovie = mediaType === "movie";
  const streams = [];

  const fail = (msg) => {
    if (DEBUG) {
      try { console.log("WitAnime FAIL:", msg, "|", DIAG.join(" > ")); } catch (e) {}
    }
    return [];
  };

  try {
    let page = null;
    let all = [];
    if (String(tmdbId).indexOf("slug:") === 0) {
      page = await tryWatch(String(tmdbId).slice(5), episode, isMovie);
    } else {
      const titles = await getContentTitles(tmdbId, mediaType);
      all = titles.slice();
      DIAG.push("titles=" + titles.join("|"));
      page = await trySlugCandidates(slugCandidates(titles, season).slice(0, 4), episode, isMovie);
      if (!page && titles.length) page = await findBySearch(titles, season, episode, isMovie);
      if (!page && titles.length) {
        const romaji = await anilistTitles(titles, season);
        all = all.concat(romaji.filter((t) => all.indexOf(t) < 0));
        DIAG.push("aliases=" + romaji.join("|"));
        const extraSlugs = slugCandidates(romaji, season).slice(0, 4);
        page = await trySlugCandidates(extraSlugs, episode, isMovie);
        if (!page && romaji.length) page = await findBySearch(romaji.concat(titles), season, episode, isMovie);
      }
    }
    if (!page) return fail("episode page not found");

    let csrf = csrfOf(page.html);
    if (!csrf) return fail("no csrf token");
    const tokens = await getTokens(page, csrf);
    csrf = page.csrf || csrf;
    if (!tokens.length) return fail("no supported servers");

    // Open several gates concurrently. The old serial loop made every slow or
    // dead host add its full timeout to the total load time and returned only
    // the first playable host. Keep a small concurrency limit for reliability.
    const candidates = tokens.slice(0, MAX_GATES);
    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= candidates.length) return;
        const t = candidates[index];
        try {
          const embed = await openGate(page, csrf, t);
          if (!embed) continue;
          DIAG.push(t.label + (t.dl ? " dl " : " ") + t.tab + " url=" + embed.slice(0, 100));
          let res;
          if (t.label === "mediafire") {
            res = await resolveMediafire(embed);
          } else if (t.label === "videa") {
            res = await resolveVidea(embed, page.url);
          } else {
            let eu = embed;
            if (t.label === "mp4upload" && !/\/embed-/.test(eu)) {
              const idm = /mp4upload\.com\/(?:embed-)?([A-Za-z0-9]+)/.exec(eu);
              if (idm) eu = "https://www.mp4upload.com/embed-" + idm[1] + ".html";
            }
            res = await resolveCloudstreamHost(t.label, eu, page.url);
          }
          DIAG.push(t.label + " " + res.info + " links:" + res.links.length);
          const host = formatHostName(t.label);
          res.links.forEach((l) => {
            if (!isPlayableMediaUrl(l.url)) return;
            streams.push({
              name: "WitAnime - " + host,
              title: host + " " + (t.label === "videa" && l.quality ? l.quality : t.tab) + (t.dl ? " dl" : "") + " (" + t.version + ")",
              url: l.url,
              quality: l.quality || (t.h ? t.h + "p" : "auto"),
              headers: res.headers,
            });
          });
        } catch (e) {
          DIAG.push(t.label + " err " + (e && e.message));
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(GATE_CONCURRENCY, candidates.length) }, worker));
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
