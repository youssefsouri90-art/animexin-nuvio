// Redflix provider for Nuvio.
// redflix.ac plays everything through vidbolt.st, which takes a TMDB id
// directly:  GET https://vidbolt.st/api/resolve?type=movie&id=<tmdbId>
// -> { stream: { sources: [ { url, kind:"hls", quality, master } ] } }
// No title search and no TMDB key needed.

const SITE = "https://vidbolt.st";
const API = SITE + "/api/resolve";
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
};
const PLAY_HEADERS = Object.assign({}, UA, { Referer: SITE + "/", Origin: SITE });

// ---------- helpers ----------
function b64encode(str) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < str.length; i += 3) {
    const a = str.charCodeAt(i) & 255;
    const b = i + 1 < str.length ? str.charCodeAt(i + 1) & 255 : NaN;
    const c = i + 2 < str.length ? str.charCodeAt(i + 2) & 255 : NaN;
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] +
      (isNaN(b) ? "=" : chars[(n >> 6) & 63]) + (isNaN(c) ? "=" : chars[n & 63]);
  }
  return out;
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

// every sub-playlist needs the same api_key as the master url
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

async function callResolve(type, id, season, episode) {
  const ref = { Referer: `${SITE}/${type}/${id}?theme=E50914&autoPlay=true`, Accept: "*/*" };
  const urls = [];
  if (type === "movie") {
    urls.push(`${API}?type=movie&id=${id}`);
  } else {
    // TV parameter names are not confirmed: try the common spellings
    urls.push(`${API}?type=tv&id=${id}&season=${season}&episode=${episode}`);
    urls.push(`${API}?type=tv&id=${id}&s=${season}&e=${episode}`);
  }
  let last = "";
  for (const u of urls) {
    const r = await getJson(u, ref);
    last = u.replace(API, "") + " -> " + (r.raw || "").slice(0, 160);
    if (r.ok && r.json && r.json.stream && r.json.stream.sources && r.json.stream.sources.length) {
      return { stream: r.json.stream, tried: last };
    }
  }
  return { stream: null, tried: last };
}

// Parse the HLS master that the API returns inline.
function parseMaster(text, baseUrl, key) {
  const lines = text.split(/\r?\n/);
  const media = [], variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.indexOf("#EXT-X-MEDIA") === 0) {
      media.push(line.replace(/URI="([^"]+)"/, (m, u) => 'URI="' + withKey(absUrl(baseUrl, u), key) + '"'));
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
  return { media, variants };
}

// One self-contained master per quality, so each quality is its own choice
// while audio / subtitle tracks (which are separate playlists) keep working.
function singleQualityMaster(parsed, v) {
  const text = ["#EXTM3U", "#EXT-X-VERSION:3"].concat(parsed.media, [v.info, v.url]).join("\n") + "\n";
  return "data:application/x-mpegURL;base64," + b64encode(text);
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  const fail = (m) => [{ name: "DEBUG " + dbg.concat(m).join(" > ").slice(0, 500), title: dbg.concat(m).join(" > "), url: "https://debug.invalid/", quality: "debug" }];
  try {
    const type = mediaType === "movie" ? "movie" : "tv";
    const res = await callResolve(type, tmdbId, Number(season) || 1, Number(episode) || 1);
    if (!res.stream) return fail("resolve failed " + res.tried);

    const streams = [];
    const server = res.stream.server || "vidbolt";
    for (const src of res.stream.sources) {
      if (!src || !src.url) continue;
      const key = (/[?&]api_key=([^&]+)/.exec(src.url) || [])[1] || "";

      let masterText = src.master;
      if (!masterText) {
        try { masterText = await (await fetch(src.url, { headers: PLAY_HEADERS })).text(); } catch (e) {}
      }
      const parsed = masterText ? parseMaster(masterText, src.url, key) : { media: [], variants: [] };
      const max = parsed.variants.length ? parsed.variants[0].height : 0;

      // 1) the adaptive master: player can pick quality / audio / subtitles
      streams.push({
        name: "Redflix",
        title: server + " (master)",
        url: src.url,
        quality: max ? "Auto (up to " + qualityLabel(max) + ")" : (src.quality || "Auto"),
        headers: PLAY_HEADERS,
        provider: "redflix",
      });
      // 2) each quality on its own
      parsed.variants.forEach((v) =>
        streams.push({
          name: "Redflix",
          title: server + " (" + qualityLabel(v.height) + " only)",
          url: singleQualityMaster(parsed, v),
          quality: qualityLabel(v.height),
          headers: PLAY_HEADERS,
          provider: "redflix",
        })
      );
    }
    return streams.length ? streams : fail("empty sources");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams };
