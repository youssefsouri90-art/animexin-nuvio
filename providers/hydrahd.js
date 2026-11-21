// HydraHD provider for Nuvio.
// Supports movies and TV episodes from hydrahd.gd.
// HydraHD exposes several third-party iframe servers; this provider returns
// those server URLs as independent stream choices.

const BASE = "https://hydrahd.gd";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
};

const DIAG = [];

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function norm(s) {
  return decodeEntities(s).toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarity(a, b) {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  let hit = 0;
  A.forEach((x) => { if (B.has(x)) hit++; });
  return hit / Math.max(A.size, B.size, 1);
}

function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || ""));
  return m ? m[1] : "hydrahd.gd";
}

function absUrl(rel) {
  if (/^https?:/i.test(rel)) return rel;
  return BASE + (rel[0] === "/" ? rel : "/" + rel);
}

function attrs(tag) {
  const out = {};
  String(tag).replace(/([a-zA-Z_:][\w:.-]*)\s*=\s*["']([^"']*)["']/g,
    (m, k, v) => { out[k.toLowerCase()] = decodeEntities(v); return m; });
  return out;
}

async function getText(url, headers) {
  const r = await fetch(url, { headers: Object.assign({}, UA, headers || {}) });
  const text = await r.text();
  if (!r.ok) DIAG.push("http" + r.status + ":" + url.replace(BASE, "").slice(0, 42));
  return { ok: r.ok, status: r.status, text };
}

function cleanTitleFromSlug(slug) {
  return String(slug || "")
    .replace(/^\/+(?:movie|watchseries)\//i, "")
    .replace(/-online-free.*$/i, "")
    .replace(/-watch-[\w-]+-\d{4}-online.*$/i, "")
    .replace(/-\d{4}-online.*$/i, "")
    .replace(/[-_]+/g, " ");
}

async function tmdbTitle(tmdbId, mediaType) {
  const type = mediaType === "movie" ? "movie" : "tv";
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}?api_key=${TMDB_KEY}`,
      { headers: UA }
    );
    const j = await r.json();
    return {
      title: j.name || j.title || j.original_name || j.original_title || "",
      year: Number(String(j.release_date || j.first_air_date || "").slice(0, 4)) || 0,
    };
  } catch (e) {
    DIAG.push("tmdb err");
    return { title: "", year: 0 };
  }
}

function parseSearchResults(html) {
  const out = [], seen = {};
  const re = /<a\b([^>]*)href=["']((?:https?:\/\/hydrahd\.gd)?\/(?:movie|watchseries)\/[^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = absUrl(m[2]);
    if (seen[href]) continue;
    seen[href] = 1;
    const tag = attrs("<a " + m[1] + " " + m[3] + ">");
    const text = decodeEntities(m[4].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ").trim();
    out.push({
      url: href,
      text: [tag.title, text, cleanTitleFromSlug(href)].filter(Boolean).join(" "),
      movie: /\/movie\//i.test(href),
      year: Number((/-(\d{4})-online/i.exec(href) || [])[1]) || 0,
    });
  }
  return out;
}

async function searchHydra(title, mediaType, year) {
  const u = `${BASE}/index.php?menu=search&query=${encodeURIComponent(title)}`;
  const r = await getText(u, { Referer: BASE + "/" });
  if (!r.ok) return [];
  const all = parseSearchResults(r.text);
  const wantMovie = mediaType === "movie";
  const filtered = all.filter((x) => x.movie === wantMovie);
  const pool = filtered.length ? filtered : all;
  pool.sort((a, b) => {
    const ay = year && a.year === year ? 0.35 : 0;
    const by = year && b.year === year ? 0.35 : 0;
    return (similarity(title, b.text) + by) - (similarity(title, a.text) + ay);
  });
  DIAG.push("search=" + pool.slice(0, 3).map((x) => x.url.split("/").pop()).join(","));
  return pool;
}

function extractMovieParams(html) {
  const m = /\/ajax\/mov_0\.php['"`]\s*,\s*\{\s*["']i["']\s*:\s*["']([^"']+)["']\s*,\s*["']t["']\s*:\s*["']([^"']+)["']/i.exec(html);
  return m ? { imdb: m[1], tmdb: m[2] } : null;
}

function extractTvParams(html) {
  const m = /\/ajax\/tv_0\.php['"`]\s*,\s*\{\s*["']i["']\s*:\s*["']([^"']+)["']\s*,\s*["']t["']\s*:\s*["']([^"']+)["']\s*,\s*["']s["']\s*:\s*["']([^"']+)["']\s*,\s*["']e["']\s*:\s*["']([^"']+)["']/i.exec(html);
  return m ? { imdb: m[1], show: m[2], season: m[3], episode: m[4] } : null;
}

function parseServers(html) {
  const out = [], seen = {};
  const re = /<div\b([^>]*class=["'][^"']*iframe-server-button[^"']*[^>]*)>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html))) {
    const a = attrs("<div " + m[1] + ">");
    if (!a["data-link"]) continue;
    const url = decodeEntities(a["data-link"]);
    if (!/^https?:\/\//i.test(url) || seen[url]) continue;
    seen[url] = 1;
    const body = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const name = body.replace(/\([^)]*\)/g, "").trim() || "Server";
    const q = (/\(([^)]+)\)/.exec(body) || [])[1] || "HD";
    out.push({ url, name, quality: q });
  }
  return out;
}

async function getMovieServers(pageUrl) {
  const page = await getText(pageUrl, { Referer: BASE + "/" });
  if (!page.ok) return [];
  let servers = parseServers(page.text);
  if (servers.length) return servers;

  const p = extractMovieParams(page.text);
  if (!p) return [];
  const ajax = `${BASE}/ajax/mov_0.php?i=${encodeURIComponent(p.imdb)}&t=${encodeURIComponent(p.tmdb)}`;
  const r = await getText(ajax, { Referer: pageUrl, "X-Requested-With": "XMLHttpRequest" });
  servers = parseServers(r.text);
  return servers;
}

async function getEpisodeServers(pageUrl, season, episode) {
  const page = await getText(pageUrl, { Referer: BASE + "/" });
  if (!page.ok) return [];

  let servers = parseServers(page.text);
  if (servers.length) return servers;

  const p = extractTvParams(page.text);
  if (!p) return [];
  const s = Number(season) || Number(p.season) || 1;
  const e = Number(episode) || Number(p.episode) || 1;
  const ajax = `${BASE}/ajax/tv_0.php?i=${encodeURIComponent(p.imdb)}&t=${encodeURIComponent(p.show)}&s=${s}&e=${e}`;
  const r = await getText(ajax, { Referer: pageUrl, "X-Requested-With": "XMLHttpRequest" });
  servers = parseServers(r.text);
  return servers;
}

// Resolve VixSrc's short-lived embed page to its real HLS master playlist.
// The playlist includes audio and subtitle renditions, including Arabic when
// available. The token is intentionally fetched on every request because it
// expires.
async function resolveVixSrc(tmdbId, mediaType, season, episode) {
  try {
    const id = encodeURIComponent(String(tmdbId));
    const s = Number(season) || 1;
    const e = Number(episode) || 1;
    const api = mediaType === "movie"
      ? `https://vixsrc.to/api/movie/${id}`
      : `https://vixsrc.to/api/tv/${id}/${s}/${e}`;

    const apiRes = await fetch(api, {
      headers: Object.assign({}, UA, { Referer: "https://vixsrc.to/" }),
    });
    if (!apiRes.ok) {
      DIAG.push("vix-api=" + apiRes.status);
      return null;
    }
    const apiJson = await apiRes.json();
    if (!apiJson || typeof apiJson.src !== "string") {
      DIAG.push("vix-no-src");
      return null;
    }

    const embedUrl = new URL(apiJson.src, "https://vixsrc.to/").toString();
    const embedRes = await fetch(embedUrl, {
      headers: Object.assign({}, UA, { Referer: "https://vixsrc.to/" }),
    });
    if (!embedRes.ok) {
      DIAG.push("vix-embed=" + embedRes.status);
      return null;
    }
    const html = await embedRes.text();
    const videoId = ( /window\.video\s*=\s*\{\s*id:\s*['"]([^'"]+)['"]/i.exec(html) || [] )[1];
    const block = ( /window\.masterPlaylist\s*=\s*\{([\s\S]*?)\n\s*\}/i.exec(html) || [] )[1];
    if (!videoId || !block) {
      DIAG.push("vix-no-playlist");
      return null;
    }

    const params = {};
    const re = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]*)['"]/g;
    let m;
    while ((m = re.exec(block))) params[m[1]] = m[2];
    params.h = "1";
    params.lang = "en";

    const playlist = new URL(`https://vixsrc.to/playlist/${encodeURIComponent(videoId)}`);
    Object.keys(params).forEach((key) => {
      if (params[key] !== "") playlist.searchParams.set(key, params[key]);
    });
    DIAG.push("vix-hls");
    return {
      name: "VixSrc",
      quality: "Auto (HLS)",
      url: playlist.toString(),
      headers: Object.assign({}, UA, {
        Referer: embedUrl,
        Origin: "https://vixsrc.to",
      }),
    };
  } catch (e) {
    DIAG.push("vix-error=" + String(e && e.message || e).slice(0, 80));
    return null;
  }
}

// HydraHD's tv AJAX endpoint can return Cloudflare 403 outside a browser.
// These providers expose the same episode using the TMDB id, so use them as
// a fallback when HydraHD does not expose its server buttons.
function fallbackTvServers(tmdbId, season, episode) {
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  const id = encodeURIComponent(String(tmdbId));
  return [
    {
      url: `https://vixsrc.to/tv/${id}/${s}/${e}?autoplay=true`,
      name: "VixSrc",
      quality: "HD",
    },
    {
      url: `https://vidfast.vc/tv/${id}/${s}/${e}?autoPlay=true&theme=e50914`,
      name: "VidFast",
      quality: "HD",
    },
    {
      url: `https://www.1src.org/embed/tv/${id}/${s}/${e}?autoplay=1`,
      name: "1Src",
      quality: "HD",
    },
    {
      url: `https://primesrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
      name: "PrimeSrc",
      quality: "HD",
    },
  ];
}

function fail(msg, dbg) {
  const all = (dbg || []).concat(msg, DIAG).join(" > ");
  return [{
    name: "HydraHD debug",
    title: all,
    url: "https://debug.invalid/hydrahd",
    quality: "debug",
  }];
}

async function getStreams(tmdbId, mediaType, season, episode) {
  DIAG.length = 0;
  const dbg = ["id=" + tmdbId + " type=" + mediaType + " s=" + season + " e=" + episode];
  try {
    const info = await tmdbTitle(tmdbId, mediaType);
    if (!info.title) return fail("no title", dbg);
    dbg.push("title=" + info.title + (info.year ? " year=" + info.year : ""));

    const direct = await resolveVixSrc(tmdbId, mediaType, season, episode);
    if (direct) {
      return [{
        name: "HydraHD",
        title: direct.name,
        url: direct.url,
        quality: direct.quality,
        headers: direct.headers,
        provider: "hydrahd",
      }];
    }

    const results = await searchHydra(info.title, mediaType, info.year);
    if (!results.length) return fail("not found", dbg);

    let servers = [];
    let selected = null;
    for (const candidate of results.slice(0, 5)) {
      const isMovie = mediaType === "movie";
      if (isMovie) {
        servers = await getMovieServers(candidate.url);
      } else {
        const base = candidate.url.replace(/\/$/, "");
        const url = `${base}/season/${Number(season) || 1}/episode/${Number(episode) || 1}`;
        servers = await getEpisodeServers(url, season, episode);
      }
      if (servers.length) { selected = candidate; break; }
    }
    if (!servers.length && mediaType !== "movie") {
      servers = fallbackTvServers(tmdbId, season, episode);
      selected = { url: BASE + "/" };
      DIAG.push("tv-fallback=" + servers.length);
    }
    dbg.push("page=" + (selected ? selected.url : "none"));
    dbg.push("servers=" + servers.length);
    if (!servers.length) return fail("no servers", dbg);

    return servers.map((s) => ({
      name: "HydraHD",
      title: s.name,
      url: s.url,
      quality: s.quality,
      headers: Object.assign({}, UA, { Referer: selected.url }),
      provider: "hydrahd",
    }));
  } catch (e) {
    return fail("ERROR " + String(e && e.message || e).slice(0, 100), dbg);
  }
}

module.exports = { getStreams, DIAG };
