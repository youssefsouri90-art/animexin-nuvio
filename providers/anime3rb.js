const LOCAL_SERVER = "http://127.0.0.1:8787";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
};

async function getKitsuTitles(kitsuId) {
  try {
    const r = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
      headers: { Accept: "application/vnd.api+json" },
    });
    const j = await r.json();
    const a = (j && j.data && j.data.attributes) || {};
    const t = a.titles || {};
    return [t.en, t.en_jp, t.en_us, a.canonicalTitle]
      .concat(a.abbreviatedTitles || [])
      .filter(Boolean);
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
    return getKitsuTitles(rawId.split(":")[1]);
  }
  if (/^\d+$/.test(rawId) || /^tt\d+$/i.test(rawId)) {
    const tmdbTitles = await getTmdbTitles(rawId, type);
    if (tmdbTitles.length) return tmdbTitles;
  }
  return [rawId.replace(/[-_]+/g, " ")].filter(Boolean);
}

async function getStreams(id, type, season, episode) {
  try {
    const epNum = String(episode || season || "1");
    const titles = await resolveTitles(id, type);
    if (!titles.length) return [];

    const joinedTitles = titles.slice(0, 5).join("||");
    const url = `${LOCAL_SERVER}/nuvio?titles=${encodeURIComponent(joinedTitles)}&ep=${encodeURIComponent(epNum)}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const streams = Array.isArray(data.streams) ? data.streams : [];
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
