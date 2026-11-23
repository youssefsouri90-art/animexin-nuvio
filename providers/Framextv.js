// FrameXTV provider for Nuvio.
// frameXTV's "barbarian_king" server is backed by themoviebox.uk, which takes a
// TMDB id directly and returns many ready-made HLS sources (Vidrock, CinemaOS,
// StreamingUnity, AoNeRoom ...):
//   GET https://themoviebox.uk/api/resolve?id=<tmdb>&type=movie
//   GET https://themoviebox.uk/api/resolve?id=<tmdb>&type=tv&s=<season>&e=<episode>
// Each source already carries a proxied "url" that supplies the right Referer.

const API = "https://themoviebox.uk/api/resolve";
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
};
const PARSE_MASTERS = true;   // read each HLS master to list its qualities
const MAX_PARSE = 10;         // ...for at most this many sources

function qualityLabel(h) {
  if (h >= 2000) return "2160p (4K)";
  if (h >= 1400) return "1440p";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h >= 460) return "480p";
  if (h >= 340) return "360p";
  return h + "p";
}

// Heights offered by an HLS master. Returns { heights, variants, audioSeparate }.
async function inspectMaster(url) {
  try {
    const txt = await (await fetch(url, { headers: UA })).text();
    if (txt.indexOf("#EXTM3U") !== 0) return null;
    const lines = txt.split(/\r?\n/);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
      let next = "";
      for (let k = i + 1; k < lines.length; k++) {
        const t = lines[k].trim();
        if (t && t[0] !== "#") { next = t; break; }
      }
      if (!res || !next) continue;
      const h = Math.max(parseInt(res[2], 10), Math.round((parseInt(res[1], 10) * 9) / 16));
      variants.push({ height: h, url: next });
    }
    variants.sort((a, b) => b.height - a.height);
    return {
      variants,
      audioSeparate: /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/.test(txt),
    };
  } catch (e) { return null; }
}

async function callResolve(type, id, season, episode) {
  let url = `${API}?id=${encodeURIComponent(id)}&type=${type}`;
  if (type === "tv") url += `&s=${season}&e=${episode}`;
  const r = await fetch(url, { headers: Object.assign({ Accept: "application/json" }, UA) });
  const t = await r.text();
  try { return { json: JSON.parse(t), raw: t }; } catch (e) { return { json: null, raw: t }; }
}

// ---------- id mapping ----------
// Nuvio passes anime as "kitsu:<id>[:<episode>]" and some titles as "tt<imdb>".
// vidbolt only understands TMDB ids, so convert first.
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

    // which TMDB season? read it from the Kitsu title ("2nd Season", "Season 3"...)
    let sn = 1;
    const sm = titles.map((t) => /(\d+)(?:st|nd|rd|th) season|season\s*(\d+)/i.exec(t)).filter(Boolean)[0];
    if (sm) sn = parseInt(sm[1] || sm[2], 10);
    const det = await tmdbGet(`tv/${best.id}`);
    const seasons = (det.seasons || []).filter((x) => x.season_number > 0);
    // episode number larger than the season: treat it as a running count
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

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  const fail = (m) => [{ name: "DEBUG " + dbg.concat(m).join(" > ").slice(0, 500), title: dbg.concat(m).join(" > "), url: "https://debug.invalid/", quality: "debug" }];
  try {
    const m = await mapToTmdb(tmdbId, mediaType, Number(season) || 1, Number(episode) || 1, dbg);
    if (!m) return fail("could not map id " + tmdbId);
    dbg.push("tmdb=" + m.id + " " + m.type + (m.type === "tv" ? " s" + m.season + "e" + m.episode : ""));

    const res = await callResolve(m.type, m.id, m.season, m.episode);
    const j = res.json;
    if (!j || !j.success || !Array.isArray(j.sources) || !j.sources.length) {
      return fail("resolve: " + (res.raw || "").slice(0, 160));
    }

    // keep playable HLS/MP4 sources, one per original url
    const seen = {};
    const src = j.sources.filter((s) => {
      if (!s || !s.url) return false;
      const key = s.original_url || s.url;
      if (seen[key]) return false;
      seen[key] = 1;
      return s.type === "hls" || s.type === "mp4" || /\.m3u8|\.mp4/.test(s.url);
    });
    if (!src.length) return fail("no playable sources");

    // list the qualities of the first sources (in parallel)
    const info = await Promise.all(
      src.map((s, i) => (PARSE_MASTERS && i < MAX_PARSE && s.type === "hls" ? inspectMaster(s.url) : Promise.resolve(null)))
    );

    const out = [];
    src.forEach((s, i) => {
      const label = (s.provider || "FrameXTV") + (s.server ? " " + s.server : "");
      const lang = s.language && s.language !== "English" ? " [" + s.language + "]" : "";
      const meta = info[i];
      const max = meta && meta.variants.length ? meta.variants[0].height : 0;

      out.push({
        name: "FrameXTV " + label + lang,
        title: label,
        url: s.url,
        quality: max ? "Auto (up to " + qualityLabel(max) + ")" : (s.quality || "Auto"),
        headers: UA,
        provider: "framextv",
      });
    });
    return out;
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams };
