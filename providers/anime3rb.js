// Standalone Anime3rb (anime3rb.com) provider for Nuvio (no local Termux server).

const SITE_BASE = "https://anime3rb.com";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
};

const SLUG_ALIASES = {
  "the-apothecary-diaries": ["kusuriya-no-hitorigoto", "the-apothecary-diaries"],
};

function toSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function qualityRank(q) {
  const s = String(q || "").toLowerCase();
  if (s.includes("2160") || s.includes("4k")) return 4;
  if (s.includes("1080")) return 3;
  if (s.includes("720")) return 2;
  if (s.includes("480")) return 1;
  return 0;
}

function extractSnapshots(html) {
  const matches = [...html.matchAll(/wire:snapshot=["']([^"']+)["']/gi)];
  const out = [];
  for (const m of matches) {
    const raw = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#039;/g, "'");
    try {
      out.push(JSON.parse(raw));
    } catch (_) {}
  }
  return out;
}

function extractVideoSources(playerHtml) {
  const unescaped = String(playerHtml).replace(/\\\//g, "/");
  const results = [];
  const seenUrls = new Set();

  const objMatches = [...unescaped.matchAll(/\{[^{}]*"src"\s*:\s*"[^"]*"[^{}]*\}/g)];
  for (const om of objMatches) {
    const objStr = om[0];
    const srcMatch = /"src"\s*:\s*"([^"]+)"/.exec(objStr);
    if (!srcMatch || !srcMatch[1]) continue;

    const url = srcMatch[1].trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (/"premium"\s*:\s*true/i.test(objStr)) continue;

    const labelMatch = /"label"\s*:\s*"([^"]+)"/.exec(objStr);
    const resMatch = /"res"\s*:\s*"?(\d{3,4})"?/.exec(objStr);

    let quality = "Stream";
    if (labelMatch && labelMatch[1] && !/premium/i.test(labelMatch[1])) {
      quality = labelMatch[1].trim();
    } else if (resMatch && resMatch[1]) {
      quality = `${resMatch[1]}p`;
    } else {
      const speedMatch = /[?&]speed=(\d+)/i.exec(url);
      if (speedMatch) {
        const sp = Number(speedMatch[1]);
        if (sp >= 400) quality = "1080p";
        else if (sp >= 190) quality = "720p";
        else if (sp > 0) quality = "480p";
      }
    }

    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    results.push({
      name: `Anime3rb - ${quality}`,
      title: `Anime3rb - ${quality}`,
      quality,
      url,
      headers: {
        Referer: "https://video.vid3rb.com/",
        "User-Agent": UA["User-Agent"],
      },
    });
  }

  results.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
  return results;
}

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
  } catch (_) {
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
  } catch (_) {
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

async function resolveValidSlug(titles) {
  const expanded = [];
  for (const title of titles.slice(0, 5)) {
    const baseSlug = toSlug(title);
    if (!baseSlug) continue;
    const list = SLUG_ALIASES[baseSlug] || [baseSlug];
    for (const s of list) {
      if (!expanded.includes(s)) expanded.push(s);
    }
  }

  for (const s of expanded) {
    try {
      const r = await fetch(`${SITE_BASE}/titles/${encodeURIComponent(s)}`, {
        headers: { ...UA, Referer: `${SITE_BASE}/` },
      });
      if (r.ok) {
        const html = await r.text();
        if (html.includes(`/episode/${s}`)) {
          return s;
        }
      }
    } catch (_) {}
  }
  return expanded[0] || "";
}

async function getStreams(id, type, season, episode) {
  try {
    const epNum = String(episode || season || "1");
    const titles = await resolveTitles(id, type);
    if (!titles.length) return [];

    const slug = await resolveValidSlug(titles);
    if (!slug) return [];

    const episodeUrl = `${SITE_BASE}/episode/${encodeURIComponent(slug)}/${encodeURIComponent(epNum)}`;
    const epRes = await fetch(episodeUrl, {
      headers: { ...UA, Referer: `${SITE_BASE}/` },
    });
    if (!epRes.ok) return [];

    const epHtml = await epRes.text();
    const snaps = extractSnapshots(epHtml);
    const videoSnap = snaps.find(
      (s) => s && s.memo && s.memo.name === "video.show-video"
    );
    const rawVideoUrl = videoSnap && videoSnap.data && videoSnap.data.video_url;
    if (!rawVideoUrl) return [];

    const playerUrl = String(rawVideoUrl).replace(/\\\//g, "/");
    const playerRes = await fetch(playerUrl, {
      headers: { ...UA, Referer: episodeUrl },
    });
    if (!playerRes.ok) return [];

    const playerHtml = await playerRes.text();
    return extractVideoSources(playerHtml);
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
