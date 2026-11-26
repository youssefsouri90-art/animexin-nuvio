// KoiAnime provider for Nuvio (QuickJS: no DOM, no Node APIs).
// Flow: TMDB (titles + season year) -> AniList id (GraphQL) ->
//       GET /api/koi/sources?provider=hdN&id=al:{anilistId}&ep={n}&type=sub|dub
//       -> master/hls (site proxy + direct), mp4, kwik iframes -> quality list.
// Testing shortcut (skips TMDB/AniList): getStreams("al:154587", "tv", 1, 1)

const BASE = "https://koianime.lol";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b"; // TMDB v3 key

const INCLUDE_DUB = true;       // also ask hd1 for the dub track
const ADD_DIRECT_LINKS = true;  // besides the site's proxy URL, add the original host URL

const UA_STR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const API_HEADERS = {
  "User-Agent": UA_STR,
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: BASE + "/",
};
const PROVIDER_NAMES = { hd1: "Vega", hd2: "Rigel", hd3: "Altair", hd4: "Antares" };

const DIAG = [];
const sleep = (ms) => new Promise((r) => (typeof setTimeout === "function" ? setTimeout(r, ms) : r()));

// fetch with retries on network failures (never on HTTP errors)
async function fx(url, opts, tries) {
  tries = tries || 3;
  let last = null;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts || {}); }
    catch (e) { last = e; await sleep(500 * (i + 1)); }
  }
  throw last || new Error("fetch failed");
}
async function getJson(url, headers) {
  const r = await fx(url, { headers: Object.assign({}, API_HEADERS, headers || {}) });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; }
  catch (e) { return { status: r.status, json: null, raw: t.slice(0, 80) }; }
}

// ---------- helpers ----------
const norm = (s) =>
  String(s || "").toLowerCase().replace(/&#8217;|&#039;|&amp;|’|'/g, "").replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();
function similarity(a, b) {
  const A = new Set(norm(a).split(" ")), B = new Set(norm(b).split(" "));
  let hit = 0;
  A.forEach((w) => B.has(w) && hit++);
  return hit / Math.max(A.size, B.size, 1);
}
function absUrl(base, rel) {
  if (/^https?:/i.test(rel)) return rel;
  if (/^\/\//.test(rel)) return "https:" + rel;
  if (rel[0] === "/") return base.replace(/^(https?:\/\/[^\/]+).*/, "$1") + rel;
  return base.replace(/[^\/]*$/, "") + rel;
}
function qualityLabel(h) {
  if (h >= 2000) return "2160p (4K)";
  if (h >= 1400) return "1440p";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h >= 460) return "480p";
  if (h >= 340) return "360p";
  return h + "p";
}
const heightOf = (q) => { const m = /(\d{3,4})\s*p?/.exec(String(q || "")); return m ? parseInt(m[1], 10) : 0; };

// Dean Edwards p.a.c.k.e.r unpacker (kwik pages use it).
function unpack(src) {
  try {
    const m = /\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/.exec(src);
    if (!m) return "";
    let p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const a = parseInt(m[2], 10);
    let c = parseInt(m[3], 10);
    const k = m[4].split("|");
    const base = (n) => (n < a ? "" : base(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    while (c--) if (k[c]) p = p.replace(new RegExp("\\b" + base(c) + "\\b", "g"), k[c]);
    return p;
  } catch (e) { return ""; }
}

// ---------- TMDB -> AniList ----------
const ORD = { 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th" };
const ORDW = { 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth" };
function seasonRe(n) {
  return new RegExp("(?:\\b" + n + "(?:st|nd|rd|th) season|season " + n + "\\b|\\b" + (ORDW[n] || "zzz") + " season|\\b" + n + "nd\\b|\\b" + n + "rd\\b|\\b" + n + "th\\b)", "i");
}

async function tmdbInfo(tmdbId, mediaType, season) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const info = { titles: [], year: 0, seasonYear: 0 };
  try {
    const j = await (await fx(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`)).json();
    [j.name || j.title, j.original_name || j.original_title].forEach((t) => { if (t && info.titles.indexOf(t) < 0) info.titles.push(t); });
    const d = j.first_air_date || j.release_date || "";
    info.year = parseInt(d.slice(0, 4), 10) || 0;
  } catch (e) { DIAG.push("tmdb err"); }
  if (type === "tv" && season > 0) {
    try {
      const s = await (await fx(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_KEY}&language=en-US`)).json();
      info.seasonYear = parseInt(String(s.air_date || "").slice(0, 4), 10) || 0;
    } catch (e) {}
  }
  return info;
}

async function findAnilistId(info, season, isMovie) {
  const q = "query($s:String){Page(perPage:8){media(search:$s,type:ANIME,sort:SEARCH_MATCH){id format seasonYear title{romaji english native} synonyms}}}";
  const wantYear = info.seasonYear || info.year;
  const queries = [];
  info.titles.forEach((t) => {
    if (season > 1) queries.push(`${t} ${ORD[season] || season} season`);
    queries.push(t);
  });
  let best = null;
  for (const text of queries.slice(0, 4)) {
    try {
      const r = await fx("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: q, variables: { s: text } }),
      });
      const j = await r.json();
      const media = (j && j.data && j.data.Page && j.data.Page.media) || [];
      media.forEach((m) => {
        const names = [m.title.romaji, m.title.english].concat(m.synonyms || []).filter(Boolean);
        let score = Math.max.apply(null, info.titles.concat([text]).map((t) => Math.max.apply(null, names.map((n) => similarity(t, n)).concat([0]))));
        const hay = names.join(" | ");
        if (season > 1) score += seasonRe(season).test(hay) ? 0.25 : -0.1;
        else if (/\b(2nd|3rd|4th|season [2-9]|part [2-9])\b/i.test(hay)) score -= 0.25;
        if (wantYear && m.seasonYear) score += m.seasonYear === wantYear ? 0.3 : -0.15;
        if (isMovie) score += m.format === "MOVIE" ? 0.2 : -0.2;
        else if (m.format === "MOVIE") score -= 0.3;
        if (!best || score > best.score) best = { score, id: m.id, name: m.title.romaji || m.title.english };
      });
      if (best && best.score >= 1.0) break;
    } catch (e) { DIAG.push("anilist err"); }
  }
  if (!best || best.score < 0.5) return null;
  DIAG.push("anilist " + best.id + " (" + best.name + ") s=" + best.score.toFixed(2));
  return best.id;
}

// ---------- quality handling ----------
// Expand an HLS master into per-quality links. If the master carries a separate
// audio rendition, per-quality playlists would be silent, so only "Auto" is kept.
async function expandHls(masterUrl, hdrs) {
  const out = [{ url: masterUrl, quality: "Auto", height: 0 }];
  try {
    const r = await fx(masterUrl, { headers: hdrs }, 2);
    const txt = await r.text();
    if (txt.indexOf("#EXTM3U") !== 0) { DIAG.push("master? " + r.status + ":" + txt.slice(0, 40).replace(/\s+/g, " ")); return out; }
    if (/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/i.test(txt)) { DIAG.push("hls-audio:separate"); return out; }
    const lines = txt.split(/\r?\n/);
    const by = {};
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      let next = "";
      for (let k = i + 1; k < lines.length; k++) { const t = lines[k].trim(); if (t && t[0] !== "#") { next = t; break; } }
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
      if (!next || !res) continue;
      const h = Math.max(parseInt(res[2], 10), Math.round((parseInt(res[1], 10) * 9) / 16));
      const bw = parseInt((/BANDWIDTH=(\d+)/.exec(lines[i]) || [0, 0])[1], 10);
      if (!by[h] || bw > by[h].bw) by[h] = { url: absUrl(masterUrl, next), bw };
    }
    const hs = Object.keys(by).map(Number).sort((a, b) => b - a);
    if (hs.length) {
      out[0].quality = "Auto (up to " + qualityLabel(hs[0]) + ")";
      out[0].height = hs[0];
      hs.forEach((h) => out.push({ url: by[h].url, quality: qualityLabel(h), height: h }));
    }
  } catch (e) { DIAG.push("hls err"); }
  return out;
}

// ---------- kwik (hd2: animepahe) ----------
async function resolveKwik(embedUrl, referer, quality) {
  try {
    const r = await fx(embedUrl, { headers: { "User-Agent": UA_STR, Referer: referer || "https://animepahe.ru/", "Accept-Language": "en-US,en;q=0.9" } }, 2);
    const html = await r.text();
    const text = html + "\n" + unpack(html);
    const m = /source\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/.exec(text) || /(https?:\/\/[^'"\s\\]+\.m3u8[^'"\s\\]*)/.exec(text);
    DIAG.push("kwik " + quality + " http=" + r.status + " len=" + html.length + (m ? " ok" : " none"));
    if (!m) return [];
    return [{ url: m[1].replace(/\\\//g, "/"), quality: quality || "Auto", height: heightOf(quality), hdrs: { "User-Agent": UA_STR, Referer: "https://kwik.cx/" } }];
  } catch (e) { DIAG.push("kwik err"); return []; }
}

// ---------- sources ----------
function normSubs(list) {
  const subs = (Array.isArray(list) ? list : []).filter((s) => s && s.url).map((s) => {
    const url = absUrl(BASE + "/", s.url);
    const label = s.lang || s.label || "Subtitles";
    return { url, lang: label, language: label, label, name: label, _srt: /\.srt|format=srt|\.vtt/i.test(url) ? 0 : 1, _en: /english/i.test(label) ? 0 : 1 };
  });
  subs.sort((a, b) => a._en - b._en || a._srt - b._srt);
  return subs.slice(0, 8).map((s) => ({ url: s.url, lang: s.lang, language: s.language, label: s.label, name: s.name }));
}

async function fromProvider(provider, alId, ep, type) {
  const url = `${BASE}/api/koi/sources?provider=${provider}&id=al:${alId}&ep=${ep}&type=${type}`;
  const res = await getJson(url);
  const j = res.json;
  if (!j || !Array.isArray(j.sources)) { DIAG.push(provider + "/" + type + ":" + res.status + (res.raw ? " " + res.raw : "")); return []; }
  DIAG.push(provider + "/" + type + ":" + j.sources.map((s) => s.type).join("+") + " subs=" + (j.subtitles || []).length);
  const subs = normSubs(j.subtitles);
  const out = [];
  const label = "Koi " + (PROVIDER_NAMES[provider] || provider);
  const siteHdr = { "User-Agent": UA_STR, Referer: BASE + "/" };

  for (const s of j.sources) {
    if (!s || !s.url) continue;
    const kind = String(s.type || "").toLowerCase();
    const links = [];
    if (kind === "master" || kind === "hls") {
      const u = absUrl(BASE + "/", s.url);
      (await expandHls(u, siteHdr)).forEach((l) => links.push(Object.assign({ hdrs: siteHdr, tag: "" }, l)));
      if (ADD_DIRECT_LINKS && s.originalUrl && /^https?:/i.test(s.originalUrl) && s.originalUrl !== u) {
        const dh = { "User-Agent": UA_STR, Referer: s.upstreamReferer || BASE + "/" };
        links.push({ url: s.originalUrl, quality: "Auto", height: 0, hdrs: dh, tag: " (direct)" });
      }
    } else if (kind === "mp4") {
      links.push({ url: absUrl(BASE + "/", s.url), quality: s.quality || "Direct", height: heightOf(s.quality),
        hdrs: { "User-Agent": UA_STR, Referer: s.upstreamReferer || BASE + "/" }, tag: "" });
    } else if (kind === "iframe") {
      if (/kwik\./i.test(s.url)) (await resolveKwik(s.url, s.upstreamReferer, s.quality)).forEach((l) => links.push(Object.assign({ tag: "" }, l)));
      else DIAG.push(provider + " iframe skipped: " + (/^https?:\/\/([^\/]+)/.exec(s.url) || [0, "?"])[1]);
    }
    links.forEach((l) => out.push({
      name: label,
      title: label + " " + type.toUpperCase() + (l.tag || ""),
      url: l.url,
      quality: l.quality,
      height: l.height || 0,
      headers: l.hdrs || siteHdr,
      subtitles: subs,
    }));
  }
  return out;
}

// ---------- main ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  DIAG.length = 0;
  season = Number(season) || 1;
  episode = Number(episode) || 1;
  const isMovie = mediaType === "movie";
  const debug = (msg) => [{ name: "Koi DEBUG", quality: "debug", title: msg + " > " + DIAG.join(" > "), url: "https://debug.invalid/" }];

  try {
    let alId = 0;
    if (/^al:\d+$/.test(String(tmdbId))) {
      alId = parseInt(String(tmdbId).slice(3), 10);
    } else {
      const info = await tmdbInfo(tmdbId, mediaType, isMovie ? 0 : season);
      DIAG.push("titles=" + info.titles.join("|") + " y=" + (info.seasonYear || info.year));
      if (!info.titles.length) return debug("no tmdb titles");
      alId = await findAnilistId(info, isMovie ? 1 : season, isMovie);
    }
    if (!alId) return debug("anilist id not found");

    // providers (fall back to the known list if the call fails)
    let providers = ["hd1", "hd2", "hd3"];
    try {
      const pr = await getJson(BASE + "/api/koi/providers");
      const ids = pr.json && Array.isArray(pr.json.providers) ? pr.json.providers.map((p) => String(p.id)).filter((id) => /^hd\d+$/.test(id)) : [];
      if (ids.length) providers = ids;
    } catch (e) {}

    const jobs = [];
    providers.forEach((p) => {
      jobs.push(fromProvider(p, alId, isMovie ? 1 : episode, "sub").catch((e) => { DIAG.push(p + " err " + (e && e.message)); return []; }));
    });
    if (INCLUDE_DUB && providers.indexOf("hd1") >= 0) {
      jobs.push(fromProvider("hd1", alId, isMovie ? 1 : episode, "dub").catch(() => []));
    }
    const groups = await Promise.all(jobs);

    const streams = [];
    groups.forEach((g) => {
      g.sort((a, b) => b.height - a.height);
      g.forEach((s) => { delete s.height; streams.push(s); });
    });
    if (!streams.length) return debug("no playable streams (al:" + alId + " ep " + episode + ")");
    return streams;
  } catch (e) {
    return debug("error " + (e && e.message));
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
