const MAIN_URL = "https://witanime.site";
const YONAPLAY_ORIGIN = "https://mid.yonaplay.net";
const REQUEST_TIMEOUT_MS = 4500;
const CACHE_TTL_MS = 5 * 60 * 1000;

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  Referer: MAIN_URL + "/",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const searchCache = new Map();
const episodesCache = new Map();

function getCached(cache, key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.exp) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(cache, key, value, ttlMs = CACHE_TTL_MS) {
  cache.set(key, { value, exp: Date.now() + ttlMs });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function toAbsoluteUrl(rawUrl, base = MAIN_URL) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const cleaned = rawUrl.trim().replace(/\\\//g, "/");
  if (!cleaned) return "";
  if (cleaned.startsWith("//")) return "https:" + cleaned;
  if (cleaned.startsWith("/")) return base.replace(/\/+$/, "") + cleaned;
  try {
    return new URL(cleaned, base).toString();
  } catch {
    return "";
  }
}

function base64ToBytes(b64) {
  const clean = String(b64).trim().replace(/\s+/g, "");
  if (typeof atob !== "function") return new Uint8Array(0);
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function sha256Bytes(text) {
  const encoded = new TextEncoder().encode(String(text));
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error("WebCrypto subtle unavailable");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

async function decryptYonaPlayAesGcm(b64Data, pageKey) {
  if (!b64Data || !pageKey) return null;
  try {
    if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
    const keyBytes = await sha256Bytes(pageKey);
    const raw = base64ToBytes(b64Data);
    if (raw.length <= 28) return null;

    const iv = raw.slice(0, 12);
    const tag = raw.slice(12, 28);
    const cipherText = raw.slice(28);

    const payloadWithTag = new Uint8Array(cipherText.length + tag.length);
    payloadWithTag.set(cipherText, 0);
    payloadWithTag.set(tag, cipherText.length);

    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      cryptoKey,
      payloadWithTag
    );

    return new TextDecoder("utf-8").decode(new Uint8Array(decryptedBuffer)).trim();
  } catch {
    return null;
  }
}

function normalizeSubtitle(subUrl, lang = "ar", label = "Arabic", idx = 0) {
  const fullUrl = toAbsoluteUrl(subUrl, YONAPLAY_ORIGIN);
  if (!fullUrl) return null;
  const code = String(lang || "ar").toLowerCase();
  const displayName = label || (code === "ar" ? "Arabic" : code.toUpperCase());
  return {
    id: "witanime-sub-" + idx,
    name: displayName,
    lang: code,
    language: displayName,
    label: displayName,
    url: fullUrl,
  };
}

function normalizeQuality(rawQuality) {
  const q = String(rawQuality || "").toUpperCase();
  if (q.includes("4K") || q.includes("2160")) return "2160p";
  if (q.includes("FHD") || q.includes("1080")) return "1080p";
  if (q.includes("HD") || q.includes("720")) return "720p";
  if (q.includes("SD") || q.includes("480")) return "480p";
  return rawQuality || "Auto";
}

async function buildStreamsFromYonaPlay({
  b64Data,
  pageKey,
  version = "SUB",
  referer = YONAPLAY_ORIGIN + "/",
}) {
  const plain = await decryptYonaPlayAesGcm(b64Data, pageKey);
  if (!plain) return [];

  const verTag = String(version || "SUB").toUpperCase();
  const headers = {
    "User-Agent": USER_AGENT,
    Referer: toAbsoluteUrl(referer, YONAPLAY_ORIGIN) || YONAPLAY_ORIGIN + "/",
  };

  const streams = [];
  const seenUrls = new Set();

  const addStream = (url, serverName, rawQuality) => {
    const fullUrl = toAbsoluteUrl(url, YONAPLAY_ORIGIN);
    if (!fullUrl || !/^https?:\/\//i.test(fullUrl) || seenUrls.has(fullUrl)) return;
    seenUrls.add(fullUrl);

    const quality = normalizeQuality(rawQuality);
    const server = serverName || "YonaPlay";
    streams.push({
      name: "WitAnime (" + verTag + ")",
      title: server + " · " + verTag + " · " + quality,
      quality,
      url: fullUrl,
      headers,
      subtitles: [],
    });
  };

  if (/^https?:\/\//i.test(plain)) {
    addStream(plain, "YonaPlay", "Auto");
    return streams;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(plain);
  } catch {
    return [];
  }

  const subtitles = [];
  const subRaw = parsed?.subUrl || parsed?.subtitle || parsed?.sub;
  if (typeof subRaw === "string" && subRaw.trim()) {
    const subObj = normalizeSubtitle(
      subRaw,
      parsed?.subLang || "ar",
      parsed?.subLabel || "Arabic",
      0
    );
    if (subObj) subtitles.push(subObj);
  }

  const pool =
    parsed?.qualities || parsed?.sources || parsed?.streams || parsed;

  if (pool && typeof pool === "object") {
    for (const [qKey, entry] of Object.entries(pool)) {
      if (typeof entry === "string") {
        addStream(entry, "YonaPlay", qKey);
      } else if (entry && typeof entry === "object") {
        for (const [srvName, link] of Object.entries(entry)) {
          if (typeof link === "string") {
            addStream(link, srvName, qKey);
          }
        }
      }
    }
  }

  if (subtitles.length > 0) {
    for (const item of streams) {
      item.subtitles = subtitles;
    }
  }

  return streams;
}

function parseInput(rawId, mediaType, season, episode) {
  const isMovie = mediaType === "movie";
  const parsedEp = Number(episode);
  const epNum = isMovie ? 1 : parsedEp > 0 ? parsedEp : 1;

  const rawStr = String(rawId || "").trim();
  let query = rawStr;

  if (/^(tmdb|imdb|mal|kitsu)[:\-]/i.test(rawStr) || /^tt\d+$/i.test(rawStr)) {
    const firstPart = rawStr.split(":")[0] || rawStr;
    query = firstPart.replace(/^(tmdb|mal|kitsu)[:\-]/i, "").trim();
  }

  return { query, epNum, isMovie };
}

async function searchAnime(query) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery || /^\d+$/.test(cleanQuery) || /^tt\d+$/i.test(cleanQuery)) {
    return [];
  }

  const cacheKey = cleanQuery.toLowerCase();
  const cached = getCached(searchCache, cacheKey);
  if (cached) return cached;

  const url =
    MAIN_URL + "/?search_param=animes&s=" + encodeURIComponent(cleanQuery);
  const res = await fetchWithTimeout(url, { headers: BASE_HEADERS });
  if (!res.ok) return [];

  const html = await res.text();
  const results = [];
  const seen = new Set();
  const regex =
    /<a[^>]+href=["'](https?:\/\/witanime\.site\/anime\/[^"']+|\/anime\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(regex)) {
    const fullUrl = toAbsoluteUrl(match[1], MAIN_URL);
    if (!fullUrl || seen.has(fullUrl)) continue;
    const title = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!title) continue;
    seen.add(fullUrl);
    results.push({ title, url: fullUrl });
  }

  setCached(searchCache, cacheKey, results);
  return results;
}

async function resolveEpisodeWatchUrl(animeUrl, epNum) {
  let html = getCached(episodesCache, animeUrl);
  if (!html) {
    const res = await fetchWithTimeout(animeUrl, { headers: BASE_HEADERS });
    if (!res.ok) return null;
    html = await res.text();
    setCached(episodesCache, animeUrl, html);
  }

  const links = [];
  const seen = new Set();
  const regex =
    /<a[^>]+href=["'](https?:\/\/witanime\.site\/watch\/[^"']+|\/watch\/[^"']+)["'][^>]*>/gi;

  for (const match of html.matchAll(regex)) {
    const fullUrl = toAbsoluteUrl(match[1], MAIN_URL);
    if (!fullUrl || seen.has(fullUrl)) continue;
    if (/\/(sources|stream-|download-|app-webview)/i.test(fullUrl)) continue;
    seen.add(fullUrl);
    links.push(fullUrl);
  }

  if (!links.length) return null;

  const suffix = "/" + String(epNum);
  const matched = links.find((u) => u.replace(/\/+$/, "").endsWith(suffix));
  return matched || links[0];
}

async function fetchSourcesManifest(watchUrl) {
  const res = await fetchWithTimeout(watchUrl, { headers: BASE_HEADERS });
  if (!res.ok) return null;

  const html = await res.text();
  const csrfToken =
    html.match(
      /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i
    )?.[1] ?? "";

  const rawSourcesUrl =
    html.match(/sourcesUrl\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null;

  const sourcesUrl = rawSourcesUrl
    ? toAbsoluteUrl(rawSourcesUrl, MAIN_URL)
    : watchUrl.replace(/\/+$/, "") + "/sources";

  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  const cookieHeader = setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    "X-CSRF-TOKEN": csrfToken,
    "X-Requested-With": "XMLHttpRequest",
    Origin: MAIN_URL,
    Referer: watchUrl,
  };
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const srcRes = await fetchWithTimeout(sourcesUrl, {
    method: "POST",
    headers,
  });

  if (!srcRes.ok) return null;

  try {
    return await srcRes.json();
  } catch {
    return null;
  }
}

async function getStreams(id, mediaType = "tv", season = 1, episode = 1) {
  try {
    if (id && typeof id === "object" && id.b64Data && id.pageKey) {
      return await buildStreamsFromYonaPlay(id);
    }

    const { query, epNum } = parseInput(id, mediaType, season, episode);
    if (!query) return [];

    const candidates = await searchAnime(query);
    if (!candidates.length) return [];

    const watchUrl = await resolveEpisodeWatchUrl(candidates[0].url, epNum);
    if (!watchUrl) return [];

    const manifest = await fetchSourcesManifest(watchUrl);
    if (!manifest || typeof manifest !== "object") return [];

    const streams = [];
    const players =
      manifest.players && typeof manifest.players === "object"
        ? Object.values(manifest.players).flat()
        : [];

    for (const player of players) {
      if (player && player.b64Data && player.pageKey) {
        const decoded = await buildStreamsFromYonaPlay({
          b64Data: player.b64Data,
          pageKey: player.pageKey,
          version: player.version || "SUB",
          referer: YONAPLAY_ORIGIN + "/",
        });
        streams.push(...decoded);
      }
    }

    const unique = [];
    const seen = new Set();
    for (const s of streams) {
      if (!s?.url || seen.has(s.url)) continue;
      seen.add(s.url);
      unique.push(s);
    }

    return unique;
  } catch {
    return [];
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
