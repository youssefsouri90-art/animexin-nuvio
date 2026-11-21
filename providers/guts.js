// Guts (guts.to) provider for Nuvio (QuickJS runtime: no DOM, no Node APIs).
// Flow: TMDB title(s) -> /ajax/search/suggest -> anime id (slug-ID)
//   -> /ajax/v2/episode/servers (SUB only, never DUB)
//   -> /ajax/v2/episode/sources -> player embed -> direct links.
// Servers handled:
//   MuL-AuD (15), Vidplay (4), DatSaV (14)  -> play.vhscdn.to .../getSources
//   DGHG (2)                                -> DoodStream (playmogo.com)
//   BYFMS (1) is skipped (JS-only player).
// No WeTV subtitles here. The site's own soft-sub tracks (if the player
// returns any) are passed through when SITE_SUBS is true.

const BASE = "https://guts.to";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

// Set to false if the streams already have the subtitles burned in.
const SITE_SUBS = true;

// Allowed server ids (data-server-id), in priority order.
const ALLOWED = ["15", "4", "14", "2"];

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

async function getText(url, headers) {
  const r = await fetch(url, { headers: Object.assign({}, UA, headers || {}) });
  if (!r.ok) DIAG.push("http" + r.status + ":" + url.replace(BASE, "").slice(0, 30));
  return await r.text();
}

async function ajaxJson(url) {
  const t = await getText(url, AJAX);
  try {
    return JSON.parse(t);
  } catch (e) {
    DIAG.push("badjson:" + url.replace(BASE, "").slice(0, 40) + ":" + t.slice(0, 40).replace(/\s+/g, " "));
    return null;
  }
}

function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(u);
  return m ? m[1] : u;
}

function randAlnum(n) {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
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

// ---------- TMDB ----------
async function getTitles(tmdbId, mediaType) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const j = await (await fetch(
    `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=alternative_titles`
  )).json();
  const out = [j.name || j.title, j.original_name || j.original_title];
  const alt = (j.alternative_titles && (j.alternative_titles.results || j.alternative_titles.titles)) || [];
  alt.forEach((a) => {
    if (a && a.title && /^(JP|US|GB)$/.test(a.iso_3166_1 || "")) out.push(a.title);
  });
  const seen = {}, res = [];
  out.forEach((t) => {
    if (!t) return;
    const k = norm(t);
    if (!k || seen[k]) return; // skips non-latin titles (empty after norm)
    seen[k] = 1;
    res.push(t);
  });
  return res.slice(0, 6);
}

// ---------- Kitsu (Nuvio sends ids like "kitsu:3936:1" for anime) ----------
async function getKitsuTitles(kitsuId) {
  const r = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
    headers: { Accept: "application/vnd.api+json" },
  });
  if (!r.ok) DIAG.push("kitsu http" + r.status);
  const j = await r.json();
  const a = (j && j.data && j.data.attributes) || {};
  const t = a.titles || {};
  const out = [t.en, t.en_jp, t.en_us, a.canonicalTitle].concat(a.abbreviatedTitles || []);
  const seen = {}, res = [];
  out.forEach((x) => {
    if (!x) return;
    const k = norm(x);
    if (!k || seen[k]) return;
    seen[k] = 1;
    res.push(x);
  });
  return { titles: res.slice(0, 6), subtype: a.subtype || "" };
}

// ---------- site: search ----------
async function searchSite(q) {
  const j = await ajaxJson(`${BASE}/ajax/search/suggest?keyword=${encodeURIComponent(q)}`);
  const html = j && j.html ? String(j.html) : "";
  const out = [], seen = {};
  const re = /<a\b[^>]*href="(?:https?:\/\/guts\.to)?\/anime\/([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    const id = (/-(\d+)$/.exec(slug) || [])[1];
    if (!id || seen[id]) continue;
    seen[id] = 1;
    const inner = m[2];
    const alt = (/alt="([^"]*)"/.exec(inner) || [])[1] || "";
    const texts = inner.replace(/<[^>]+>/g, "|").split("|")
      .map((s) => decodeEntities(s).trim()).filter((s) => s.length > 1);
    const names = [decodeEntities(alt).replace(/\s+Japanese english subbed.*$/i, "")]
      .concat(texts, [slug.replace(/-\d+$/, "").replace(/-/g, " ")])
      .filter(Boolean);
    out.push({ id, slug, names });
  }
  return out;
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

async function findAnime(titles, mediaType, season) {
  const queries = [];
  titles.forEach((t) => {
    if (mediaType === "tv" && season > 1) queries.push(`${t} season ${season}`);
    queries.push(t);
  });
  let best = null;
  const tried = {};
  for (const q of queries) {
    if (tried[q]) continue;
    tried[q] = 1;
    for (const r of await searchSite(q)) {
      let score = 0;
      titles.forEach((t) => r.names.forEach((n) => { score = Math.max(score, similarity(t, n)); }));
      score += seasonBoost(r.names, season);
      if (!best || score > best.score) best = Object.assign({ score }, r);
    }
    if (best && best.score >= 0.9) break;
  }
  return best && best.score >= 0.5 ? best : null;
}

// ---------- site: servers / sources ----------
async function getServers(movieId, ep) {
  const j = await ajaxJson(`${BASE}/ajax/v2/episode/servers?episodeId=${ep}&mov_id=${movieId}`);
  if (!j || !j.html) return [];
  const html = Array.isArray(j.html) ? j.html.join("") : String(j.html);
  const re = /data-type="(\w+)"[^>]*?data-id="([0-9a-f]+)"[^>]*?data-server-id="(\d+)"[^>]*>\s*<a[^>]*>([^<]*)<\/a>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== "sub") continue; // SUB only, never DUB
    if (ALLOWED.indexOf(m[3]) < 0) continue;
    out.push({ type: m[1], id: m[2], sid: m[3], name: decodeEntities(m[4]).trim() });
  }
  out.sort((a, b) => ALLOWED.indexOf(a.sid) - ALLOWED.indexOf(b.sid));
  return out;
}

async function getSourceLink(serverDataId) {
  const j = await ajaxJson(`${BASE}/ajax/v2/episode/sources?id=${serverDataId}`);
  return j && j.link ? String(j.link) : "";
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
      // scope/letterboxed video (e.g. 1280x544) is really the 720p tier
      const h = Math.max(hRaw, Math.round((wRaw * 9) / 16));
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

// ---------- play.vhscdn.to (MuL-AuD / Vidplay / DatSaV) ----------
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
    if (kind === "thumbnails" || /thumbnail/i.test(label)) return;
    if (!/\.(vtt|srt|ass|ssa)(\?|$)/i.test(t.file) && kind !== "captions" && kind !== "subtitles") return;
    const key = label.toLowerCase().split(/[\s(]/)[0];
    const lang = LANGS[key] || key || "und";
    out.push({ url: t.file, lang: lang, language: lang, label: label || lang, name: label || lang });
  });
  return out;
}

async function tryJson(url, headers) {
  try {
    const t = await getText(url, headers);
    const j = JSON.parse(t);
    return j && j.sources ? j : null;
  } catch (e) { return null; }
}

const QH = { HD: 1080, HQ: 720, SD: 480 }; // only used for sorting

async function resolveVhs(link) {
  const m = /^(https?:\/\/[^\/]+)\/([^\/]+)\/([^\/?#]+)/.exec(link);
  if (!m) return { links: [], tracks: [] };
  const origin = m[1];
  const api = `${origin}/${m[2]}/getSources?id=${encodeURIComponent(m[3])}`;
  const H = { Referer: link, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };
  const PH = Object.assign({}, UA, { Referer: origin + "/", Origin: origin });

  let j = await tryJson(api, H);
  if (!j) {
    // some embeds only answer after the embed page itself was requested
    try { await getText(link, { Referer: BASE + "/" }); } catch (e) {}
    j = await tryJson(api, H);
  }
  if (!j) { DIAG.push("vhs:nosources " + origin.slice(8) + "/" + m[2]); return { links: [], tracks: [] }; }

  const links = [], seen = {};
  const push = (l) => { if (l.url && !seen[l.url]) { seen[l.url] = 1; l.hdrs = PH; links.push(l); } };
  const src = j.sources;

  if (typeof src === "string") {
    if (/m3u8/i.test(src)) (await expandHls(src, PH)).forEach(push);
    else push({ url: src, quality: "Direct", height: 0 });
  } else if (Array.isArray(src)) {
    for (const it of src) {
      const u = typeof it === "string" ? it : it && (it.file || it.url);
      if (!u) continue;
      if (/m3u8/i.test(u)) (await expandHls(u, PH)).forEach(push);
      else push({ url: u, quality: (it && it.label) || "Direct", height: parseInt((it && it.label) || "", 10) || 0 });
    }
  } else if (src && typeof src === "object") {
    for (const k of Object.keys(src)) {
      const arr = Array.isArray(src[k]) ? src[k] : [src[k]];
      for (const u of arr) {
        if (typeof u !== "string") continue;
        if (/m3u8/i.test(u)) (await expandHls(u, PH)).forEach(push);
        else push({ url: u, quality: k, height: QH[k] || parseInt(k, 10) || 0 });
      }
    }
  }
  DIAG.push("vhs:" + m[2] + ":" + links.length);
  return { links, tracks: toSubtitles(j.tracks) };
}

// ---------- DoodStream (playmogo.com ...) ----------
async function resolveDood(link) {
  const origin = (/^(https?:\/\/[^\/]+)/.exec(link) || [])[1];
  if (!origin) return { links: [], tracks: [] };
  const html = await getText(link, { Referer: BASE + "/" });
  const pm = /\/pass_md5\/([^'"\s]+)/.exec(html);
  if (!pm) { DIAG.push("dood:nopass len=" + html.length); return { links: [], tracks: [] }; }
  const token = pm[1].split("/").pop();
  const base = (await getText(origin + "/pass_md5/" + pm[1], { Referer: link })).trim();
  if (!/^https?:/i.test(base)) { DIAG.push("dood:bad " + base.slice(0, 30)); return { links: [], tracks: [] }; }
  const PH = Object.assign({}, UA, { Referer: origin + "/" });
  DIAG.push("dood:ok");
  return {
    links: [{ url: base + randAlnum(10) + "?token=" + token + "&expiry=" + Date.now(), quality: "Direct", height: 0, hdrs: PH }],
    tracks: [],
  };
}

async function resolveServer(s) {
  try {
    const link = await getSourceLink(s.id);
    if (!link) { DIAG.push(s.name + ":nolink"); return { links: [], tracks: [] }; }
    if (/vhscdn\./i.test(link)) return await resolveVhs(link);
    if (/playmogo|dood|d000d|ds2play|dsvplay|d0o0d|do7go|vide0\.net/i.test(hostOf(link))) return await resolveDood(link);
    DIAG.push(s.name + ":unsupported " + hostOf(link));
  } catch (e) { DIAG.push(s.name + " err " + (e && e.message)); }
  return { links: [], tracks: [] };
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  DIAG.length = 0;

  // Debug output: Nuvio shows only name/quality, so the message is split
  // across several fake streams' `name` field (60 chars each).
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
    let ep = isTv ? Number(episode) || 1 : 1;
    let seasonNum = Number(season) || 1;
    dbg.push("id=" + tmdbId + " s=" + season + " e=" + episode);

    let titles;
    const kp = /^kitsu:(\d+)(?::(\d+))?/i.exec(String(tmdbId));
    if (kp) {
      // Kitsu entries are already per-season, so no season matching needed
      const k = await getKitsuTitles(kp[1]);
      titles = k.titles;
      seasonNum = 1;
      isTv = k.subtype !== "movie";
      ep = isTv ? Number(episode) || Number(kp[2]) || 1 : 1;
    } else {
      titles = await getTitles(tmdbId, isTv ? "tv" : "movie");
    }
    dbg.push("titles=" + titles.join("|"));
    if (!titles.length) return fail("no titles");

    const anime = await findAnime(titles, isTv ? "tv" : "movie", seasonNum);
    dbg.push("anime=" + (anime ? anime.slug + "(" + anime.score.toFixed(2) + ")" : "none"));
    if (!anime) return fail("series not found");

    const servers = await getServers(anime.id, ep);
    dbg.push("servers=" + servers.map((s) => s.name).join(","));
    if (!servers.length) return fail("no SUB servers");

    const results = await Promise.all(servers.map(async (s) => ({ s, r: await resolveServer(s) })));

    const streams = [], seenUrl = {};
    results.forEach(({ s, r }) => {
      r.links.sort((a, b) => (b.height || 0) - (a.height || 0));
      r.links.forEach((l) => {
        if (seenUrl[l.url]) return;
        seenUrl[l.url] = 1;
        const st = {
          name: "Guts",
          title: s.name + " (SUB)",
          url: l.url,
          quality: l.quality,
          headers: l.hdrs || UA,
          provider: "guts",
        };
        if (SITE_SUBS && r.tracks.length) st.subtitles = r.tracks;
        streams.push(st);
      });
    });
    return streams.length ? streams : fail("no playable streams");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams };
