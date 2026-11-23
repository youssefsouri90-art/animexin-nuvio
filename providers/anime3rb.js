// Anime3rb (anime3rb.com) provider for Nuvio via local Termux Node.js server.
// Flow:
//   kitsu:ID / TMDB id -> titles from Kitsu / TMDB
//   -> search anime3rb.com -> resolve anime slug
//   -> query local Termux server (http://127.0.0.1:8787/nuvio) -> { streams }

const LOCAL_SERVER = "http://127.0.0.1:8787";
const SITE_BASE = "https://anime3rb.com";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
};

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
  return decodeEntities(s)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function similarity(a, b) {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((w) => {
    if (B.has(w)) hit++;
  });
  return hit / Math.max(A.size, B.size, 1);
}

async function getKitsuTitles(kitsuId) {
  try {
    const r = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
      headers: { Accept: "application/vnd.api+json" },
    });
    const j = await r.json();
    const a = (j && j.data && j.data.attributes) || {};
    const t = a.titles || {};
    return [t.en, t.en_jp, t.en_us, a.canonicalTitle].concat(
      a.abbreviatedTitles || []
    ).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function getTmdbTitles(tmdbId, mediaType) {
  try {
    const cleanId = String(tmdbId).replace(/^tt/i, "");
    const type = mediaType === "movie" ? "movie" : "tv";
    const r = await fetch(
      `https://api.themoviedb.org/3/${type}/${cleanId}?api_key=${TMDB_KEY}&append_to_response=alternative_titles`
    );
    const j = await r.json();
    const out = [j.name || j.title, j.original_name || j.original_title];
    const alt =
      (j.alternative_titles &&
        (j.alternative_titles.results || j.alternative_titles.titles)) ||
      [];
    alt.forEach((item) => {
      if (item && item.title) out.push(item.title);
    });
    return out.filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function resolveTitles(id, type) {
  const rawId = String(id || "").trim();
  if (/^kitsu:/i.test(rawId)) {
    const kid = rawId.split(":")[1];
    return getKitsuTitles(kid);
  }
  if (/^\d+$/.test(rawId) || /^tt\d+$/i.test(rawId)) {
    const tmdbTitles = await getTmdbTitles(rawId, type);
    if (tmdbTitles.length) return tmdbTitles;
  }
  return [rawId.replace(/[-_]+/g, " ")].filter(Boolean);
}

async function searchAnime3rbSlug(titles) {
  const seenSlugs = {};
  const candidates = [];

  for (const title of titles.slice(0, 4)) {
    const q = encodeURIComponent(title);
    const urls = [
      `${SITE_BASE}/search?q=${q}`,
      `${SITE_BASE}/anime?search=${q}`,
    ];

    for (const u of urls) {
      try {
        const res = await fetch(u, { headers: Object.assign({}, UA, { Referer: SITE_BASE + "/" }) });
        if (!res.ok) continue;
        const html = await res.text();
        const re = /href="(?:https?:\/\/anime3rb\.com)?\/(?:anime|title)\/([a-z0-9][a-z0-9-]*)"/gi;
        let m;
        while ((m = re.exec(html))) {
          const slug = m[1];
          if (!slug || seenSlugs[slug]) continue;
          seenSlugs[slug] = 1;
          const slugTitle = slug.replace(/-/g, " ");
          let bestScore = 0;
          titles.forEach((t) => {
            bestScore = Math.max(bestScore, similarity(t, slugTitle));
          });
          candidates.push({ slug, score: bestScore });
        }
        if (candidates.length) break;
      } catch (e) {}
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length && candidates[0].score >= 0.35) {
    return candidates[0].slug;
  }
  return titles.length ? toSlug(titles[0]) : "";
}

async function fetchLocalStreams(slug, ep) {
  const url = `${LOCAL_SERVER}/nuvio?slug=${encodeURIComponent(slug)}&ep=${encodeURIComponent(ep)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.streams) ? data.streams : [];
}

async function getStreams(id, type, season, episode) {
  try {
    const epNum = String(episode || season || "1");
    const titles = await resolveTitles(id, type);
    const slug = await searchAnime3rbSlug(titles);
    if (!slug) return [];

    const streams = await fetchLocalStreams(slug, epNum);
    return streams.map((s) => ({
      name: s.name || `Anime3rb (${s.quality || "MP4"})`,
      title: s.name || `Anime3rb - ${s.quality || "MP4"}`,
      url: s.url,
      quality: s.quality || "auto",
      headers: s.headers || {
        Referer: "https://video.vid3rb.com/",
        "User-Agent": UA["User-Agent"],
      },
    }));
  } catch (e) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
