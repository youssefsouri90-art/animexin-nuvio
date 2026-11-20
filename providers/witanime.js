// WitAnime diagnostic build for Nuvio (QuickJS)
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

const MAX_GATES = 2;
const GATE_DELAY_MS = 200;
const SUPPORTED = ["mp4upload"];
const DL_SUPPORTED = ["mp4upload", "mediafire"];
const TAB_H = { FHD: 1080, HD: 720, SD: 480 };

const DIAG = [];
let JAR = {};
const sleep = (ms) => new Promise((r) => (typeof setTimeout === "function" ? setTimeout(r, ms) : r()));

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

async function fx(url, opts, tries) {
  tries = tries || 2;
  let last = null;
  const own = String(url).indexOf(BASE) === 0;
  for (let i = 0; i < tries; i++) {
    try {
      const o = Object.assign({}, opts || {});
      o.headers = Object.assign({}, o.headers || {});
      const ck = own ? jarHeader() : "";
      if (ck) o.headers["Cookie"] = ck;
      const r = await fetch(url, o);
      if (own) jarUpdate(r);
      return r;
    } catch (e) {
      last = e;
      await sleep(300);
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
      const r = await fx(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=${lang}`, {}, 1);
      const j = await r.json();
      [j.name || j.title, j.original_name || j.original_title].forEach((t) => {
        if (t && out.indexOf(t) < 0) out.push(t);
      });
      DIAG.push("tmdb:" + lang + ":" + (j.name || j.title || "none"));
    } catch (e) {
      DIAG.push("tmdb:" + lang + ":err");
    }
  }
  return out;
}

async function anilistTitles(queries, season) {
  const out = [];
  const q = "query($s:String){Page(perPage:5){media(search:$s,type:ANIME){title{romaji english} synonyms}}}";
  for (const text of queries.slice(0, 2)) {
    try {
      const r = await fx(
        "https://graphql.anilist.co",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query: q, variables: { s: text } }),
        },
        1
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
        DIAG.push("anilist:ok");
        break;
      }
    } catch (e) {
      DIAG.push("anilist:err");
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
  return out.slice(0, 6);
}

async function tryWatch(slug, episode, isMovie) {
  const url = isMovie ? `${BASE}/watch/movie/${slug}` : `${BASE}/watch/${slug}/${episode}`;
  try {
    const r = await fx(url, { headers: pageHeaders(BASE + "/") });
    const html = await r.text();
    const bad = (r.status && r.status >= 400) || html.length < 1500 || /data-status="404"/.test(html);
    DIAG.push("try:" + slug + ":" + (r.status || "?") + (bad ? ":x" : ":ok"));
    return bad ? null : { url, html, slug };
  } catch (e) {
    DIAG.push("try:" + slug + ":err");
    return null;
  }
}

async function search(query) {
  let html = "";
  try {
    html = await (await fx(`${BASE}/search?q=${encodeURIComponent(query)}`, { headers: pageHeaders(BASE + "/") })).text();
  } catch (e) {
    DIAG.push("search:err");
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
  DIAG.push("search:" + results.length);
  return results;
}

async function findBySearch(titles, season, episode, isMovie) {
  const queries = [];
  titles.forEach((t) => {
    if (season > 1) queries.push(`${t} ${ORD[season] || season} season`);
    queries.push(t);
  });
  let best = null;
  for (const q of queries.slice(0, 3)) {
    for (const r of await search(q)) {
      let score = Math.max(similarity(q, r.title), similarity(q, r.slugTitle));
      if (season > 1 && seasonRe(season).test(r.title + " " + r.slugTitle)) score += 0.3;
      if (!best || score > best.score) best = Object.assign({ score }, r);
    }
    if (best && best.score >= 0.8) break;
  }
  if (!best || best.score < 0.5) return null;
  DIAG.push("best:" + best.slug);
  return await tryWatch(best.slug, episode, isMovie);
}

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
  try { j = JSON.parse(txt); } catch (e) { DIAG.push("sources:badjson"); return []; }
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
  DIAG.push("tokens:" + out.length);
  return out;
}

async function openGate(page, csrf, t) {
  const kind = t.dl ? "download" : "stream";
  const gateUrl = `${BASE}/watch/${kind}-gate/${t.token}`;
  try {
    const sr = await fx(`${BASE}/watch/${kind}-source/${t.token}`, { method: "POST", headers: xhrHeaders(page, csrf), body: "" }, 1);
    DIAG.push(t.label + ":src:" + sr.status);
    if (sr.status >= 400) return "";
    await sleep(1000);
    const gh = t.dl
      ? Object.assign({}, pageHeaders(page.url, "document", "same-origin"))
      : Object.assign({}, pageHeaders("", "iframe", "same-origin"));
    const ck = jarHeader();
    if (ck) gh["Cookie"] = ck;
    const gr = await fetch(gateUrl, { redirect: "manual", headers: gh });
    jarUpdate(gr);
    let loc = "";
    try { loc = (gr.headers && typeof gr.headers.get === "function" && gr.headers.get("location")) || ""; } catch (e) {}
    if (!loc && gr.url && gr.url !== gateUrl && /^https?:/i.test(gr.url)) loc = gr.url;
    DIAG.push(t.label + ":gate:" + gr.status + ":" + (loc ? "ok" : "no"));
    return cleanUrl(loc);
  } catch (e) {
    DIAG.push(t.label + ":gate:err");
    return "";
  }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  DIAG.length = 0;
  JAR = {};
  const diagItem = (msg) => [
    {
      name: "WitAnime DIAG",
      quality: "debug",
      title: msg + " | " + DIAG.join(" > "),
      url: BASE + "/",
    },
  ];

  try {
    DIAG.push("id:" + tmdbId + ":" + mediaType + ":s" + season + "e" + episode);
    let page = null;
    let all = [];
    if (String(tmdbId).indexOf("slug:") === 0) {
      page = await tryWatch(String(tmdbId).slice(5), episode, mediaType === "movie");
    } else {
      const titles = await getTmdbTitles(tmdbId, mediaType);
      const romaji = await anilistTitles(titles, season);
      all = romaji.concat(titles.filter((t) => romaji.indexOf(t) < 0));
      for (const slug of slugCandidates(all, season)) {
        page = await tryWatch(slug, episode, mediaType === "movie");
        if (page) break;
      }
      if (!page && all.length) page = await findBySearch(all, season, episode, mediaType === "movie");
    }
    if (!page) return diagItem("no_page");

    const csrf = csrfOf(page.html);
    if (!csrf) return diagItem("no_csrf");

    const tokens = await getTokens(page, csrf);
    if (!tokens.length) return diagItem("no_tokens");

    const streams = [];
    for (const t of tokens.slice(0, MAX_GATES)) {
      if (streams.length) await sleep(GATE_DELAY_MS);
      const embed = await openGate(page, csrf, t);
      if (embed) {
        streams.push({
          name: "WitAnime - " + t.label,
          title: t.label + " " + t.tab + (t.dl ? " dl" : "") + " (" + t.version + ")",
          url: embed,
          quality: t.h ? t.h + "p" : "auto",
          headers: { "User-Agent": UA_STR, Referer: BASE + "/" },
        });
      }
    }
    return streams.length ? streams : diagItem("no_embeds");
  } catch (e) {
    return diagItem("crash:" + (e && e.message ? e.message : "unknown"));
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
