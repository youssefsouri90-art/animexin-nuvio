// HydraHD (VixSrc) provider for Nuvio - QuickJS-safe (no URL / URLSearchParams).
// Returns only a real HLS playlist. Embed pages (iframes) are NOT returned
// because the Nuvio player cannot play HTML pages.

const VIX = "https://vixsrc.to";
const UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

const DIAG = [];

function enc(x) {
  return encodeURIComponent(String(x));
}

function absVix(u) {
  u = String(u || "");
  if (/^https?:/i.test(u)) return u;
  return VIX + (u[0] === "/" ? u : "/" + u);
}

async function resolveVixSrc(tmdbId, mediaType, season, episode) {
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  const api =
    mediaType === "movie"
      ? `${VIX}/api/movie/${enc(tmdbId)}`
      : `${VIX}/api/tv/${enc(tmdbId)}/${s}/${e}`;
  const H = { "User-Agent": UA, Referer: VIX + "/" };

  const apiRes = await fetch(api, { headers: H });
  if (!apiRes.ok) {
    DIAG.push("vix-api=" + apiRes.status);
    return null;
  }
  let src = "";
  try {
    src = JSON.parse(await apiRes.text()).src;
  } catch (err) {
    DIAG.push("vix-api-json");
    return null;
  }
  if (!src) {
    DIAG.push("vix-no-src");
    return null;
  }

  const embedRes = await fetch(absVix(src), { headers: H });
  if (!embedRes.ok) {
    DIAG.push("vix-embed=" + embedRes.status);
    return null;
  }
  const html = await embedRes.text();
  DIAG.push("embed-len=" + html.length);

  // Params block: 'token': '...', 'expires': '...'
  const pb = (/window\.masterPlaylist\s*=\s*\{\s*params\s*:\s*\{([\s\S]*?)\}/i.exec(html) || [])[1] || "";
  const params = {};
  const re = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]*)['"]/g;
  let m;
  while ((m = re.exec(pb))) params[m[1]] = m[2];
  if (!params.token) {
    params.token = (/['"]token['"]\s*:\s*['"]([^'"]+)['"]/i.exec(html) || [])[1];
    params.expires = (/['"]expires['"]\s*:\s*['"]([^'"]+)['"]/i.exec(html) || [])[1];
  }
  if (!params.token) {
    DIAG.push("vix-no-token");
    return null;
  }

  // Prefer the playlist url given by the page; fall back to the video id.
  let base = (/window\.masterPlaylist[\s\S]*?\burl\s*:\s*['"]([^'"]+)['"]/i.exec(html) || [])[1];
  if (!base) {
    const id = (/window\.video\s*=\s*\{[\s\S]*?\bid["']?\s*:\s*["']?(\d+)/i.exec(html) || [])[1];
    if (!id) {
      DIAG.push("vix-no-id");
      return null;
    }
    base = `${VIX}/playlist/${id}`;
  }
  base = absVix(base);

  params.h = "1";
  params.lang = "en";
  const qs = Object.keys(params)
    .filter((k) => params[k] !== "" && params[k] != null)
    .map((k) => enc(k) + "=" + enc(params[k]))
    .join("&");
  const url = base + (base.indexOf("?") >= 0 ? "&" : "?") + qs;

  DIAG.push("vix-hls");
  return {
    url,
    headers: { "User-Agent": "ExoPlayerDemo/1.0", Referer: VIX + "/" },
  };
}

function fail(msg, dbg) {
  return [
    {
      name: "HydraHD debug",
      title: (dbg || []).concat(msg, DIAG).join(" > "),
      url: "https://debug.invalid/hydrahd",
      quality: "debug",
    },
  ];
}

async function getStreams(tmdbId, mediaType, season, episode) {
  DIAG.length = 0;
  const dbg = ["id=" + tmdbId + " type=" + mediaType + " s=" + season + " e=" + episode];
  try {
    const d = await resolveVixSrc(tmdbId, mediaType, season, episode);
    if (!d) return fail("vixsrc failed", dbg);
    return [
      {
        name: "HydraHD",
        title: "VixSrc",
        url: d.url,
        quality: "Auto (HLS)",
        headers: d.headers,
        provider: "hydrahd",
      },
    ];
  } catch (e) {
    return fail("ERROR " + String((e && e.message) || e).slice(0, 100), dbg);
  }
}

module.exports = { getStreams, DIAG };
