// Redflix provider for Nuvio (Vidbolt + Vidly).
const SITE = "https://redflix.ac";
const VIDBOLT_SITE = "https://vidbolt.st";
const VIDBOLT_API = VIDBOLT_SITE + "/api/resolve";
const VIDLY_SITE = "https://vidly.pro";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
};

function playHeadersFor(url) {
  try {
    const o = new URL(url).origin;
    return Object.assign({}, UA, { Referer: o + "/", Origin: o });
  } catch (e) {
    return Object.assign({}, UA, { Referer: VIDBOLT_SITE + "/", Origin: VIDBOLT_SITE });
  }
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
  return base.replace(/[?#].*$/, "").replace(/[^\/]*$/, "") + rel;
}

function withKey(u, key) {
  if (!key || /[?&]api_key=/.test(u)) return u;
  return u + (u.indexOf("?") >= 0 ? "&" : "?") + "api_key=" + key;
}

async function getJson(url, headers) {
  const r = await fetch(url, { headers: Object.assign({}, UA, headers || {}) });
  const t = await r.text();
  try { return { ok: true, json: JSON.parse(t), raw: t }; }
  catch (e) { return { ok: false, raw: t }; }
}

function parseMaster(text, baseUrl, key) {
  const lines = text.split(/\r?\n/);
  const media = [], audioTracks = [], variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.indexOf("#EXT-X-MEDIA") === 0) {
      const updated = line.replace(/URI="([^"]+)"/, (m, u) => 'URI="' + withKey(absUrl(baseUrl, u), key) + '"');
      media.push(updated);
      if (/TYPE=AUDIO/.test(updated)) {
        const nameMatch = /NAME="([^"]+)"/.exec(updated);
        audioTracks.push((nameMatch && nameMatch[1]) || "Audio");
      }
    } else if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
      let next = "";
      for (let k = i + 1; k < lines.length; k++) {
        const t = lines[k].trim();
        if (t && t[0] !== "#") { next = t; break; }
      }
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      if (!next || !res) continue;
      const h = Math.max(parseInt(res[2], 10), Math.round((parseInt(res[1], 10) * 9) / 16));
      variants.push({ info: line, url: withKey(absUrl(baseUrl, next), key), height: h });
    }
  }
  variants.sort((a, b) => b.height - a.height);
  return { media, audioTracks, variants };
}

function buildMasterStream(label, masterUrl, masterText, fallbackQuality) {
  const key = (/[?&]api_key=([^&]+)/.exec(masterUrl) || [])[1] || "";
  const parsed = masterText ? parseMaster(masterText, masterUrl, key) : { media: [], audioTracks: [], variants: [] };
  const max = parsed.variants.length ? parsed.variants[0].height : 0;
  const audioInfo = parsed.audioTracks.length ? " | " + parsed.audioTracks.join(", ") : "";
  return {
    name: "Redflix",
    title: label + " (Audio" + audioInfo + ")",
    url: masterUrl,
    quality: max ? "Auto (up to " + qualityLabel(max) + ")" : (fallbackQuality || "Auto"),
    headers: playHeadersFor(masterUrl),
    provider: "redflix",
  };
}

// ---------- Vidbolt ----------
async function fetchVidbolt(type, id, season, episode) {
  const ref = { Referer: `${VIDBOLT_SITE}/${type}/${id}?theme=E50914&autoPlay=true`, Accept: "*/*" };
  const urls = type === "movie"
    ? [`${VIDBOLT_API}?type=movie&id=${id}`]
    : [
        `${VIDBOLT_API}?type=tv&id=${id}&season=${season}&episode=${episode}`,
        `${VIDBOLT_API}?type=tv&id=${id}&s=${season}&e=${episode}`,
      ];

  let streamObj = null;
  for (const u of urls) {
    const r = await getJson(u, ref);
    if (r.ok && r.json && r.json.stream && r.json.stream.sources && r.json.stream.sources.length) {
      streamObj = r.json.stream;
      break;
    }
  }
  if (!streamObj) return [];

  const out = [];
  const server = streamObj.server || "vidbolt";
  for (const src of streamObj.sources) {
    if (!src || !src.url) continue;
    let masterText = src.master;
    if (!masterText) {
      try {
        masterText = await (await fetch(src.url, { headers: playHeadersFor(src.url) })).text();
      } catch (e) {}
    }
    out.push(buildMasterStream(server, src.url, masterText, src.quality || "Auto"));
  }
  return out;
}

// ---------- Vidly ----------
async function fetchVidly(type, id, season, episode) {
  const pageUrl = type === "movie"
    ? `${VIDLY_SITE}/movie/${id}`
    : `${VIDLY_SITE}/tv/${id}/${season}/${episode}`;
  try {
    const r = await fetch(pageUrl, {
      headers: Object.assign({}, UA, {
        Referer: SITE + "/",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }),
    });
    if (!r.ok) return [];
    const html = await r.text();
    const matches = [...html.matchAll(/https?:\/\/[^"'\''\s<>]+\.m3u8[^"'\''\s<>]*/gi)].map((m) => m[0]);
    const unique = [...new Set(matches)];
    const out = [];
    for (const mUrl of unique) {
      let masterText = "";
      try {
        masterText = await (await fetch(mUrl, { headers: playHeadersFor(mUrl) })).text();
      } catch (e) {}
      out.push(buildMasterStream("vidly", mUrl, masterText, "Auto"));
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ---------- ID mapping ----------
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

async function tmdbGet(path) {
  try {
    const sep = path.indexOf("?") >= 0 ? "&" : "?";
    return await (await fetch(`https://api.themoviedb.org/3/${path}${sep}api_key=${TMDB_KEY}`)).json();
  } catch (e) { return {}; }
}

const normT = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function simT(a, b) {
  const A = new Set(normT(a).split(" ")), B = new Set(normT(b).split(" "));
  let hit = 0;
  A.forEach((w) => B.has(w) && hit++);
  return hit / Math.max(A.size, B.size, 1);
}

async function mapToTmdb(rawId, mediaType, season, episode, dbg) {
  const id = String(rawId);
  if (/^\d+$/.test(id)) return { id, type: mediaType === "movie" ? "movie" : "tv", season, episode };

  const imdb = /^(tt\d+)/.exec(id);
  if (imdb) {
    const f = await tmdbGet(`find/${imdb[1]}?external_source=imdb_id`);
    const hit = (f.tv_results && f.tv_results[0]) || (f.movie_results && f.movie_results[0]);
    if (!hit) return null;
    const isTv = !!(f.tv_results && f.tv_results[0]);
    return { id: String(hit.id), type: isTv ? "tv" : "movie", season, episode };
  }

  const k = /^kitsu:(\d+)(?::(\d+))?/.exec(id);
  if (k) {
    let ep = Number(episode) || Number(k[2]) || 1;
    const kj = await (await fetch(`https://kitsu.io/api/edge/anime/${k[1]}`, {
      headers: { Accept: "application/vnd.api+json" },
    })).json();
    const at = (kj.data && kj.data.attributes) || {};
    const titles = [at.titles && at.titles.en, at.canonicalTitle, at.titles && at.titles.en_jp]
      .filter(Boolean);
    if (!titles.length) return null;
    dbg.push("kitsu=" + titles[0]);

    const isMovie = at.subtype === "movie" || mediaType === "movie";
    const clean = (t) => t.replace(/\b(\d+)(st|nd|rd|th) season\b/gi, " ").replace(/\bseason\s*\d+\b/gi, " ")
      .replace(/\bpart\s*\d+\b/gi, " ").replace(/\s+/g, " ").trim();
    let best = null;
    for (const t of titles) {
      const q = clean(t);
      const r = await tmdbGet(`search/${isMovie ? "movie" : "tv"}?query=${encodeURIComponent(q)}`);
      (r.results || []).slice(0, 6).forEach((x) => {
        const sc = Math.max(simT(q, x.name || x.title), simT(q, x.original_name || x.original_title));
        if (!best || sc > best.sc) best = { id: x.id, sc };
      });
      if (best && best.sc >= 0.8) break;
    }
    if (!best || best.sc < 0.4) return null;
    if (isMovie) return { id: String(best.id), type: "movie", season: 1, episode: 1 };

    let sn = 1;
    const sm = titles.map((t) => /(\d+)(?:st|nd|rd|th) season|season\s*(\d+)/i.exec(t)).filter(Boolean)[0];
    if (sm) sn = parseInt(sm[1] || sm[2], 10);
    const det = await tmdbGet(`tv/${best.id}`);
    const seasons = (det.seasons || []).filter((x) => x.season_number > 0);
    if (!sm) {
      let left = ep;
      for (const x of seasons) {
        if (left <= x.episode_count) { sn = x.season_number; ep = left; break; }
        left -= x.episode_count;
      }
    }
    return { id: String(best.id), type: "tv", season: sn, episode: ep };
  }
  return null;
}

// ---------- Entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  const fail = (m) => [{ name: "DEBUG " + dbg.concat(m).join(" > ").slice(0, 500), title: dbg.concat(m).join(" > "), url: "https://debug.invalid/", quality: "debug" }];
  try {
    const m = await mapToTmdb(tmdbId, mediaType, Number(season) || 1, Number(episode) || 1, dbg);
    if (!m) return fail("could not map id " + tmdbId);
    dbg.push("tmdb=" + m.id + " " + m.type + " s" + m.season + "e" + m.episode);

    const [vb, vl] = await Promise.all([
      fetchVidbolt(m.type, m.id, m.season, m.episode),
      fetchVidly(m.type, m.id, m.season, m.episode),
    ]);

    const streams = [...vb, ...vl];
    return streams.length ? streams : fail("no streams from vidbolt/vidly");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams };
