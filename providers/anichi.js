// Anichi (anichi.cz) provider for Nuvio (QuickJS: no DOM, no Node APIs).
// Flow:
//   kitsu:ID (or TMDB id) -> titles (+ AniList id for exact matching)
//   -> anichi search -> /watch/<slug>/ep-N  (anime id = data-id)
//   -> /ajax/episode/list/<animeId>          (episode token = data-ids)
//   -> /ajax/server/list?servers=<token>     (server link-ids)
//   -> /ajax/server?get=<link-id>            (embed url)
//   -> <embed>/stream/getSources?id=<data-id of embed page> -> m3u8 + subs

const BASE = "https://anichi.cz";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

// Only SUB-type groups are used unless this is true.
const INCLUDE_DUB = false;
const SITE_SUBS = true;
// Writes the HTTP status of each final link into the stream name (debug).
const PROBE = false;

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
};
const AJAX = { "X-Requested-With": "XMLHttpRequest", Referer: BASE + "/" };

const DIAG = [];

// ---------- helpers ----------
function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const norm = (s) =>
  decodeEntities(s).toLowerCase().replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

function similarity(a, b) {
  const A = new Set(norm(a).split(" ")), B = new Set(norm(b).split(" "));
  let hit = 0;
  A.forEach((w) => w && B.has(w) && hit++);
  return hit / Math.max(A.size, B.size, 1);
}

function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(u);
  return m ? m[1] : u;
}

function originOf(u) {
  const m = /^(https?:\/\/[^\/?#]+)/i.exec(u);
  return m ? m[1] : "";
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

function absUrl(base, rel) {
  if (/^https?:/i.test(rel)) return rel;
  if (rel[0] === "/") return base.replace(/^(https?:\/\/[^\/]+).*/, "$1") + rel;
  return base.replace(/[^\/]*$/, "") + rel;
}

function attrs(tag) {
  const o = {};
  String(tag).replace(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g, (m, k, v) => { o[k.toLowerCase()] = decodeEntities(v); return m; });
  return o;
}

async function raw(url, headers) {
  const r = await fetch(url, { headers: Object.assign({}, UA, headers || {}) });
  const text = await r.text();
  if (!r.ok) DIAG.push("http" + r.status + ":" + url.replace(BASE, "").slice(0, 34));
  return { ok: r.ok, status: r.status, text };
}

async function getText(url, headers) {
  return (await raw(url, headers)).text;
}

async function ajaxJson(url, referer) {
  const h = Object.assign({}, AJAX);
  if (referer) h.Referer = referer;
  const t = await getText(url, h);
  try {
    return JSON.parse(t);
  } catch (e) {
    DIAG.push("badjson:" + url.replace(BASE, "").slice(0, 34) + ":" + t.slice(0, 30).replace(/\s+/g, " "));
    return null;
  }
}

// ---------- titles ----------
async function getKitsuInfo(kitsuId) {
  const out = { titles: [], anilist: "", subtype: "" };
  try {
    const r = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
      headers: { Accept: "application/vnd.api+json" },
    });
    const j = await r.json();
    const a = (j && j.data && j.data.attributes) || {};
    const t = a.titles || {};
    out.titles = [t.en, t.en_jp, t.en_us, a.canonicalTitle].concat(a.abbreviatedTitles || []);
    out.subtype = a.subtype || "";
  } catch (e) { DIAG.push("kitsu err"); }
  try {
    const r = await fetch(
      `https://kitsu.io/api/edge/anime/${kitsuId}/mappings?filter%5BexternalSite%5D=anilist%2Fanime`,
      { headers: { Accept: "application/vnd.api+json" } }
    );
    const j = await r.json();
    const d = (j && j.data && j.data[0]) || null;
    if (d && d.attributes) out.anilist = String(d.attributes.externalId || "");
  } catch (e) {}
  return out;
}

async function getTmdbTitles(tmdbId, mediaType) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const j = await (await fetch(
    `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=alternative_titles`
  )).json();
  const out = [j.name || j.title, j.original_name || j.original_title];
  const alt = (j.alternative_titles && (j.alternative_titles.results || j.alternative_titles.titles)) || [];
  alt.forEach((a) => {
    if (a && a.title && /^(JP|US|GB)$/.test(a.iso_3166_1 || "")) out.push(a.title);
  });
  return out;
}

function cleanTitles(list) {
  const seen = {}, res = [];
  list.forEach((t) => {
    if (!t) return;
    const k = norm(t);
    if (!k || seen[k]) return;
    seen[k] = 1;
    res.push(t);
  });
  return res.slice(0, 6);
}

// ---------- anichi: search ----------
function parseCandidates(html) {
  const out = [], seen = {};
  const re = /<a\b([^>]*)href="(?:https?:\/\/anichi\.cz)?\/(?:anime|watch)\/([a-z0-9][a-z0-9-]*)[^"]*"([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2];
    const tagAttrs = attrs("<a " + m[1] + " " + m[3] + ">");
    const innerAttrs = {};
    (m[4].match(/<[^>]+>/g) || []).forEach((t) => Object.assign(innerAttrs, attrs(t)));
    const texts = m[4].replace(/<[^>]+>/g, "|").split("|")
      .map((s) => decodeEntities(s).trim()).filter((s) => s.length > 1);
    const names = [tagAttrs["data-en"], tagAttrs["data-jp"], tagAttrs.title,
      innerAttrs["data-en"], innerAttrs["data-jp"], innerAttrs.alt]
      .concat(texts, [slug.replace(/-[a-z0-9]{5}$/, "").replace(/-/g, " ")])
      .filter(Boolean);
    if (seen[slug]) { seen[slug].names = seen[slug].names.concat(names); continue; }
    seen[slug] = { slug, names };
    out.push(seen[slug]);
  }
  return out;
}

async function searchSite(q) {
  const enc = encodeURIComponent(q);
  const eps = [
    `${BASE}/ajax/anime/search?keyword=${enc}`,
    `${BASE}/ajax/search?keyword=${enc}`,
    `${BASE}/filter?keyword=${enc}`,
    `${BASE}/search?keyword=${enc}`,
  ];
  for (const u of eps) {
    try {
      const r = await raw(u, { Referer: BASE + "/", "X-Requested-With": "XMLHttpRequest" });
      if (!r.ok) continue;
      let html = r.text;
      try {
        const j = JSON.parse(html);
        const v = j && (j.result != null ? j.result : j.html);
        html = typeof v === "string" ? v : Array.isArray(v) ? v.join("") : JSON.stringify(v || "");
      } catch (e) {}
      const c = parseCandidates(html);
      if (c.length) { DIAG.push("search:" + u.replace(BASE, "").split("?")[0]); return c; }
    } catch (e) {}
  }
  return [];
}

const ROMAN = { 2: "ii", 3: "iii", 4: "iv", 5: "v", 6: "vi" };

function seasonBoost(names, season) {
  if (season <= 1) return 0;
  const ord = season + (season === 2 ? "nd" : season === 3 ? "rd" : "th");
  for (const n of names) {
    const t = " " + norm(n) + " ";
    if (
      t.indexOf(" season " + season + " ") >= 0 ||
      t.indexOf(" " + ord + " season ") >= 0 ||
      (ROMAN[season] && t.indexOf(" " + ROMAN[season] + " ") >= 0)
    ) return 0.3;
  }
  return 0;
}

// watch page -> anime id + anilist id
async function getWatchInfo(slug, ep) {
  const urls = [`${BASE}/watch/${slug}/ep-${ep}`, `${BASE}/watch/${slug}`];
  for (const u of urls) {
    const r = await raw(u, { Referer: BASE + "/" });
    if (!r.ok) continue;
    const id = (/data-id="(\d+)"/.exec(r.text) || [])[1];
    const al = (/data-anilist-id="(\d+)"/.exec(r.text) || [])[1] || "";
    if (id) return { id, anilist: al, slug };
  }
  return null;
}

async function findAnime(titles, season, anilistId, ep, isTv) {
  const queries = [];
  titles.forEach((t) => {
    if (isTv && season > 1) queries.push(`${t} season ${season}`);
    queries.push(t);
  });
  const pool = {};
  const tried = {};
  let n = 0;
  for (const q of queries) {
    if (tried[q] || n >= 4) continue;
    tried[q] = 1; n++;
    for (const r of await searchSite(q)) {
      if (!pool[r.slug]) pool[r.slug] = { slug: r.slug, names: [] };
      pool[r.slug].names = pool[r.slug].names.concat(r.names);
    }
    // enough strong candidates already
    const strong = Object.keys(pool).some((k) => {
      let s = 0;
      titles.forEach((t) => pool[k].names.forEach((nm) => { s = Math.max(s, similarity(t, nm)); }));
      return s >= 0.95;
    });
    if (strong && !anilistId) break;
  }
  const list = Object.keys(pool).map((k) => {
    let score = 0;
    titles.forEach((t) => pool[k].names.forEach((nm) => { score = Math.max(score, similarity(t, nm)); }));
    score += isTv ? seasonBoost(pool[k].names, season) : 0;
    return { slug: k, score };
  }).sort((a, b) => b.score - a.score);
  DIAG.push("cands=" + list.slice(0, 3).map((c) => c.slug + ":" + c.score.toFixed(2)).join(","));

  let fallback = null;
  for (const c of list.slice(0, 4)) {
    if (c.score < 0.3) break;
    const w = await getWatchInfo(c.slug, ep);
    if (!w) continue;
    if (anilistId && w.anilist === anilistId) return Object.assign({ score: c.score, exact: true }, w);
    if (!fallback) fallback = Object.assign({ score: c.score, exact: false }, w);
  }
  if (!fallback) return null;
  if (anilistId && fallback.score < 0.8) return null; // known id but no match: don't guess low
  return fallback.score >= 0.5 ? fallback : null;
}

// ---------- anichi: episodes / servers ----------
async function getEpisodeToken(animeId, ep, slug) {
  const j = await ajaxJson(`${BASE}/ajax/episode/list/${animeId}`, `${BASE}/watch/${slug}`);
  const html = j && j.result ? (Array.isArray(j.result) ? j.result.join("") : String(j.result)) : "";
  const tags = html.match(/<a\b[^>]*data-ids="[^"]+"[^>]*>/g) || [];
  DIAG.push("eps=" + tags.length);
  let pick = null;
  for (const t of tags) {
    const a = attrs(t);
    if (String(Number(a["data-num"])) === String(Number(ep)) || a["data-num"] === String(ep)) { pick = a; break; }
  }
  if (!pick && tags.length && Number(ep) === 1) pick = attrs(tags[0]); // movies / single ep
  return pick ? { ids: pick["data-ids"], sub: pick["data-sub"], dub: pick["data-dub"] } : null;
}

async function getServers(token, slug, ep) {
  const j = await ajaxJson(`${BASE}/ajax/server/list?servers=${encodeURIComponent(token)}`, `${BASE}/watch/${slug}/ep-${ep}`);
  const html = j && j.result ? (Array.isArray(j.result) ? j.result.join("") : String(j.result)) : "";
  const out = [], groups = [];
  const gre = /<div\b[^>]*class="type"[^>]*data-type="([^"]*)"[^>]*>([\s\S]*?)<\/ul>/g;
  let g;
  while ((g = gre.exec(html))) {
    const type = g[1].toLowerCase();
    const lre = /<li\b([^>]*)>([^<]*)<\/li>/g;
    let l;
    const names = [];
    const items = [];
    while ((l = lre.exec(g[2]))) {
      const a = attrs("<li " + l[1] + ">");
      const name = decodeEntities(l[2]).trim();
      names.push(name);
      if (a["data-link-id"]) items.push({ type, name, link: a["data-link-id"] });
    }
    groups.push(type + "[" + names.join(",") + "]");
    if (!INCLUDE_DUB && /dub/.test(type)) continue;
    items.forEach((it) => out.push(it));
  }
  DIAG.push("groups=" + groups.join(" "));
  return out;
}

async function getEmbed(linkId, slug, ep) {
  const j = await ajaxJson(`${BASE}/ajax/server?get=${encodeURIComponent(linkId)}`, `${BASE}/watch/${slug}/ep-${ep}`);
  const r = j && j.result;
  return r && r.url ? String(r.url) : "";
}

// ---------- HLS ----------
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
      const h = Math.max(hRaw, Math.round((wRaw * 9) / 16)); // letterboxed -> real tier
      if (!h) continue;
      const bw = parseInt((/(?:^|[,:])BANDWIDTH=(\d+)/.exec(line) || [0, 0])[1], 10);
      const avc = /avc1/i.test(line);
      const cur = byHeight[h];
      if (!cur || (avc && !cur.avc) || (avc === cur.avc && bw > cur.bw)) {
        let vu = absUrl(masterUrl, next);
        if (!/m3u8/i.test(vu)) vu += (vu.indexOf("?") < 0 ? "?" : "&") + "v.m3u8";
        byHeight[h] = { url: vu, height: h, bw: bw, avc: avc };
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

// ---------- embed player (megaplay.buzz and similar) ----------
const LANGS = {
  english: "en", arabic: "ar", spanish: "es", portuguese: "pt", french: "fr",
  german: "de", italian: "it", russian: "ru", indonesian: "id", japanese: "ja",
  chinese: "zh", thai: "th", vietnamese: "vi", turkish: "tr", malay: "ms", korean: "ko",
};

function toSubtitles(tracks) {
  const out = [];
  (tracks || []).forEach((t) => {
    if (!t || !t.file) return;
    const kind = String(t.kind || "").toLowerCase();
    const label = String(t.label || "").trim();
    if (kind === "thumbnails" || /thumbnail/i.test(label) || /\.(jpg|png|webp)(\?|$)/i.test(t.file)) return;
    const key = label.toLowerCase().split(/[\s(]/)[0];
    const lang = LANGS[key] || key || "und";
    out.push({ url: t.file, lang: lang, language: lang, label: label || lang, name: label || lang });
  });
  return out;
}

function collectSources(src, out) {
  if (!src) return;
  if (typeof src === "string") { out.push(src); return; }
  if (Array.isArray(src)) { src.forEach((x) => collectSources(x, out)); return; }
  if (typeof src === "object") {
    if (src.file) { collectSources(src.file, out); return; }
    if (src.url) { collectSources(src.url, out); return; }
    Object.keys(src).forEach((k) => collectSources(src[k], out));
  }
}

// Megaplay now returns an AES-256-CBC encrypted `enc` payload.
// These constants match the current Megaplay player implementation.
const MP_SOURCE_KEY = "i?LMTAx0Q6,:}50U";
const MP_SOURCE_IV = "W0;27ToaUpl_P%'c";

function b64UrlToBytes(s) {
  let x = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (x.length % 4) x += "=";
  const bin = atob(x), out = [];
  for (let i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i));
  return new Uint8Array(out);
}

function paddedBytes(s, n) {
  const out = new Uint8Array(n);
  const text = String(s);
  for (let i = 0; i < Math.min(n, text.length); i++) out[i] = text.charCodeAt(i) & 255;
  return out;
}

async function decryptMegaplaySources(enc) {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("WebCrypto unavailable");
  }
  const key = await crypto.subtle.importKey(
    "raw", paddedBytes(MP_SOURCE_KEY, 32), { name: "AES-CBC" }, false, ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: paddedBytes(MP_SOURCE_IV, 16) },
    key, b64UrlToBytes(enc)
  );
  return JSON.parse(new TextDecoder().decode(new Uint8Array(plain)));
}

async function resolveEmbed(embedUrl) {
  const origin = originOf(embedUrl);
  const page = await getText(embedUrl, { Referer: BASE + "/" });
  const id = (/data-id="(\d+)"/.exec(page) || [])[1];
  if (!id) { DIAG.push("embed:noid " + hostOf(embedUrl) + " len=" + page.length); return { links: [], tracks: [] }; }

  const PH = Object.assign({}, UA, { Referer: origin + "/", Origin: origin });
  // Both paths currently return the same response; the New path is preferred.
  const api = `${origin}/stream/getSourcesNew?id=${encodeURIComponent(id)}`;
  const t = await getText(api, { Referer: embedUrl, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" });
  let j = null;
  try { j = JSON.parse(t); } catch (e) { DIAG.push("embed:badjson " + t.slice(0, 40).replace(/\s+/g, " ")); }
  if (!j) return { links: [], tracks: [] };

  const urls = [];
  let decoded = null;
  if (j.enc) {
    try {
      decoded = await decryptMegaplaySources(j.enc);
      collectSources(decoded.sources, urls);
      if (!urls.length) collectSources(decoded.file, urls);
      if (!urls.length) collectSources(decoded.url, urls);
      DIAG.push("embed:enc-ok");
    } catch (e) {
      DIAG.push("embed:enc-fail " + String(e && e.message || e).slice(0, 40));
    }
  }
  if (!urls.length) collectSources(j.sources, urls);
  if (!urls.length && j.file) collectSources(j.file, urls);
  if (!urls.length) DIAG.push("embed:keys=" + Object.keys(j).join(","));

  const links = [], seen = {};
  const push = (l) => { if (l.url && !seen[l.url]) { seen[l.url] = 1; l.hdrs = PH; links.push(l); } };
  for (const u of urls) {
    if (/m3u8/i.test(u)) (await expandHls(u, PH)).forEach(push);
    else push({ url: u, quality: "Direct", height: 0 });
  }
  const trackData = (j.tracks || (decoded && decoded.tracks) || []);
  DIAG.push("embed:" + hostOf(embedUrl) + ":" + links.length);
  return { links, tracks: toSubtitles(trackData) };
}

async function resolveServer(s, slug, ep) {
  try {
    const embed = await getEmbed(s.link, slug, ep);
    if (!embed) { DIAG.push(s.name + ":noembed"); return { links: [], tracks: [] }; }
    DIAG.push(s.name + " -> " + hostOf(embed));
    return await resolveEmbed(embed);
  } catch (e) { DIAG.push(s.name + " err " + (e && e.message)); }
  return { links: [], tracks: [] };
}

// ---------- link probe (diagnostics) ----------
async function probe(url, hdrs) {
  try {
    const r = await fetch(url, { headers: hdrs });
    let info = String(r.status);
    if (/m3u8/i.test(url)) {
      const t = await r.text();
      const first = t.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s[0] !== "#")[0];
      if (!first) return info + "/empty";
      const u2 = absUrl(url, first);
      const r2 = await fetch(u2, { headers: hdrs });
      info += "/" + r2.status;
      const t2 = await r2.text();
      const seg = t2.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s[0] !== "#")[0];
      if (seg && t2.indexOf("#EXTM3U") === 0) {
        const r3 = await fetch(absUrl(u2, seg), { headers: hdrs });
        info += "/" + r3.status;
      }
    }
    return info;
  } catch (e) {
    return "ERR " + String((e && e.message) || "").slice(0, 25);
  }
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  DIAG.length = 0;

  // Nuvio shows only name/quality, so debug text is split over several fake streams.
  const fail = (m) => {
    const msg = dbg.concat(m, DIAG).join(" > ");
    const out = [];
    for (let i = 0; i < 6; i++) {
      const part = msg.slice(i * 60, (i + 1) * 60);
      if (!part) break;
      out.push({
        name: "DBG" + (i + 1) + " " + part,
        title: msg,
        url: "https://debug.invalid/" + (i + 1),
        quality: "debug",
      });
    }
    return out;
  };

  try {
    let isTv = mediaType !== "movie";
    let seasonNum = Number(season) || 1;
    let ep = isTv ? Number(episode) || 1 : 1;
    dbg.push("id=" + tmdbId + " s=" + season + " e=" + episode);

    let titles, anilist = "";
    const kp = /^kitsu:(\d+)(?::(\d+))?/i.exec(String(tmdbId));
    if (kp) {
      const k = await getKitsuInfo(kp[1]);
      titles = cleanTitles(k.titles);
      anilist = k.anilist;
      seasonNum = 1; // kitsu entries are per season
      isTv = k.subtype !== "movie";
      ep = isTv ? Number(episode) || Number(kp[2]) || 1 : 1;
    } else {
      titles = cleanTitles(await getTmdbTitles(tmdbId, isTv ? "tv" : "movie"));
    }
    dbg.push("titles=" + titles.join("|") + (anilist ? " al=" + anilist : ""));
    if (!titles.length) return fail("no titles");

    const anime = await findAnime(titles, seasonNum, anilist, ep, isTv);
    dbg.push("anime=" + (anime ? anime.slug + "(" + anime.score.toFixed(2) + (anime.exact ? ",id" : "") + ")" : "none"));
    if (!anime) return fail("series not found");

    const tok = await getEpisodeToken(anime.id, ep, anime.slug);
    if (!tok) return fail("episode " + ep + " not found");

    const servers = await getServers(tok.ids, anime.slug, ep);
    dbg.push("servers=" + servers.map((s) => s.name + "/" + s.type).join(","));
    if (!servers.length) return fail("no servers");

    const results = await Promise.all(servers.map(async (s) => ({ s, r: await resolveServer(s, anime.slug, ep) })));

    const streams = [], seenUrl = {};
    results.forEach(({ s, r }) => {
      r.links.sort((a, b) => (b.height || 0) - (a.height || 0));
      r.links.forEach((l) => {
        if (seenUrl[l.url]) return;
        seenUrl[l.url] = 1;
        const st = {
          name: "Anichi",
          title: s.name + " (" + s.type.toUpperCase() + ")",
          url: l.url,
          quality: l.quality,
          headers: l.hdrs || UA,
          provider: "anichi",
        };
        if (SITE_SUBS && r.tracks.length) st.subtitles = r.tracks;
        streams.push(st);
      });
    });

    if (PROBE && streams.length) {
      await Promise.all(
        streams.slice(0, 8).map(async (st) => {
          const res = await probe(st.url, st.headers);
          st.name = "Anichi [" + res + "] " + hostOf(st.url).slice(0, 14);
        })
      );
    }
    return streams.length ? streams : fail("no playable streams");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams, DIAG };
