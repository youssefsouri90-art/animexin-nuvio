rm -rf jadx_debug_out
cat << 'EOF' > witanime.js
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

const animeSearchCache = new Map();
const episodesCache = new Map();

function getCached(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    cache.delete(key);
    return null;
  }
  return entry.value;
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
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(0);
}

async function sha256Bytes(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(text));
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(hashBuf);
  }
  const nodeCrypto = await import("node:crypto");
  return new Uint8Array(nodeCrypto.createHash("sha256").update(data).digest());
}

async function aes256GcmDecrypt(keyBytes, ivBytes, tagBytes, cipherBytes) {
  const ctWithTag = new Uint8Array(cipherBytes.length + tagBytes.length);
  ctWithTag.set(cipherBytes, 0);
  ctWithTag.set(tagBytes, cipherBytes.length);

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes, tagLength: 128 },
      cryptoKey,
      ctWithTag
    );
    return new TextDecoder("utf-8").decode(new Uint8Array(plainBuf)).trim();
  }

  const nodeCrypto = await import("node:crypto");
  const decipher = nodeCrypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyBytes),
    Buffer.from(ivBytes)
  );
  decipher.setAuthTag(Buffer.from(tagBytes));
  const out = Buffer.concat([
    decipher.update(Buffer.from(cipherBytes)),
    decipher.final(),
  ]);
  return out.toString("utf8").trim();
}

async function decryptYonaPlayAesGcm(b64Data, pageKey) {
  if (!b64Data || !pageKey) return null;
  try {
    const keyBytes = await sha256Bytes(pageKey);
    const raw = base64ToBytes(b64Data);
    // 12 bytes IV + 16 bytes Auth Tag + ciphertext
    if (raw.length <= 28) return null;

    const iv = raw.slice(0, 12);
    const tag = raw.slice(12, 28);
    const ciphertext = raw.slice(28);

    return await aes256GcmDecrypt(keyBytes, iv, tag, ciphertext);
  } catch {
    return null;
  }
}

function normalizeSubtitle(subUrl, lang = "ar", label = "Arabic", index = 0) {
  const fullUrl = toAbsoluteUrl(subUrl, YONAPLAY_ORIGIN);
  if (!fullUrl) return null;
  const code = String(lang || "ar").toLowerCase();
  const displayName = label || (code === "ar" ? "Arabic" : code.toUpperCase());
  return {
    id: "witanime-sub-" + index,
    name: displayName,
    lang: code,
    language: displayName,
    label: displayName,
    url: fullUrl,
  };
}

function normalizeQualityLabel(qKey) {
  const upper = String(qKey || "").toUpperCase();
  if (upper.includes("4K") || upper.includes("2160")) return "2160p";
  if (upper.includes("FHD") || upper.includes("1080")) return "1080p";
  if (upper.includes("HD") || upper.includes("720")) return "720p";
  if (upper.includes("SD") || upper.includes("480")) return "480p";
  return qKey || "Auto";
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

  const seen = new Set();
  const streams = [];

  const pushStream = (url, serverName, rawQuality) => {
    const fullUrl = toAbsoluteUrl(url, YONAPLAY_ORIGIN);
    if (!fullUrl || !/^https?:\/\//i.test(fullUrl) || seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const quality = normalizeQualityLabel(rawQuality);
    const srv = serverName || "YonaPlay";
    streams.push({
      name: "WitAnime (" + verTag + ")",
      title: srv + " · " + verTag + " · " + quality,
      quality,
      url: fullUrl,
      headers,
      subtitles: [],
    });
  };

  if (/^https?:\/\//i.test(plain)) {
    pushStream(plain, "YonaPlay", "Auto");
    return streams;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(plain);
  } catch {
    return [];
  }

  const subtitles = [];
  const rawSub = parsed?.subUrl || parsed?.subtitle || parsed?.sub;
  if (typeof rawSub === "string" && rawSub.trim()) {
    const subObj = normalizeSubtitle(
      rawSub,
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
        pushStream(entry, "YonaPlay", qKey);
      } else if (entry && typeof entry === "object") {
        for (const [srvName, link] of Object.entries(entry)) {
          if (typeof link === "string") {
            pushStream(link, srvName, qKey);
          }
        }
      }
    }
  }

  if (subtitles.length > 0) {
    for (const s of streams) {
      s.subtitles = subtitles;
    }
  }

  return streams;
}

function parseQueryAndEpisode(rawId, mediaType, season, episode) {
  const isMovie = mediaType === "movie";
  const parsedEp = Number(episode);
  const epNum = isMovie ? 1 : parsedEp > 0 ? parsedEp : 1;

  const str = String(rawId || "").trim();
  let query = str;

  if (/^(tmdb|imdb|mal|kitsu)[:\-]/i.test(str) || /^tt\d+$/i.test(str)) {
    const parts = str.split(":");
    const mainPart = parts[0] || str;
    if (parts.length >= 3 && !episode) {
      const maybeEp = Number(parts[2]);
      if (maybeEp > 0) query = mainPart;
    }
    query = mainPart.replace(/^(tmdb|mal|kitsu)[:\-]/i, "").trim();
  }

  return { query, epNum, isMovie };
}

async function searchWitAnime(query) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery || /^\d+$/.test(cleanQuery) || /^tt\d+$/i.test(cleanQuery)) {
    return [];
  }

  const cacheKey = cleanQuery.toLowerCase();
  const cached = getCached(animeSearchCache, cacheKey);
  if (cached) return cached;

  const url =
    MAIN_URL + "/?search_param=animes&s=" + encodeURIComponent(cleanQuery);
  const res = await fetchWithTimeout(url, { headers: BASE_HEADERS });
  if (!res.ok) return [];

  const html = await res.text();
  const results = [];
  const seen = new Set();
  const linkRegex =
    /<a[^>]+href=["'](https?:\/\/witanime\.site\/anime\/[^"']+|\/anime\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(linkRegex)) {
    const fullUrl = toAbsoluteUrl(match[1], MAIN_URL);
    if (!fullUrl || seen.has(fullUrl)) continue;
    const text = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    seen.add(fullUrl);
    results.push({ title: text, url: fullUrl });
  }

  setCached(animeSearchCache, cacheKey, results);
  return results;
}

async function findEpisodeWatchUrl(animeUrl, epNum) {
  const cached = getCached(episodesCache, animeUrl);
  let html = cached;

  if (!html) {
    const res = await fetchWithTimeout(animeUrl, { headers: BASE_HEADERS });
    if (!res.ok) return null;
    html = await res.text();
    setCached(episodesCache, animeUrl, html);
  }

  const watchLinks = [];
  const seen = new Set();
  const regex =
    /<a[^>]+href=["'](https?:\/\/witanime\.site\/watch\/[^"']+|\/watch\/[^"']+)["'][^>]*>/gi;

  for (const match of html.matchAll(regex)) {
    const fullUrl = toAbsoluteUrl(match[1], MAIN_URL);
    if (!fullUrl || seen.has(fullUrl)) continue;
    if (/\/(sources|stream-|download-|app-webview)/i.test(fullUrl)) continue;
    seen.add(fullUrl);
    watchLinks.push(fullUrl);
  }

  if (watchLinks.length === 0) return null;

  const targetSuffix = "/" + String(epNum);
  const exact = watchLinks.find((u) => u.replace(/\/+$/, "").endsWith(targetSuffix));
  return exact || watchLinks[0];
}

async function fetchEpisodeSources(watchUrl) {
  const res = await fetchWithTimeout(watchUrl, { headers: BASE_HEADERS });
  if (!res.ok) return null;

  const html = await res.text();
  const csrf =
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

  const postHeaders = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    "X-CSRF-TOKEN": csrf,
    "X-Requested-With": "XMLHttpRequest",
    Origin: MAIN_URL,
    Referer: watchUrl,
  };
  if (cookieHeader) {
    postHeaders.Cookie = cookieHeader;
  }

  const srcRes = await fetchWithTimeout(sourcesUrl, {
    method: "POST",
    headers: postHeaders,
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

    const { query, epNum } = parseQueryAndEpisode(id, mediaType, season, episode);
    if (!query) return [];

    const candidates = await searchWitAnime(query);
    if (!candidates.length) return [];

    const watchUrl = await findEpisodeWatchUrl(candidates[0].url, epNum);
    if (!watchUrl) return [];

    const manifest = await fetchEpisodeSources(watchUrl);
    if (!manifest || typeof manifest !== "object") return [];

    // في حال توفرت حمولات YonaPlay مشفرة ضمن الاستجابة مستقبلاً
    const streams = [];
    const players = manifest.players && typeof manifest.players === "object"
      ? Object.values(manifest.players).flat()
      : [];

    for (const entry of players) {
      if (entry && entry.b64Data && entry.pageKey) {
        const decoded = await buildStreamsFromYonaPlay({
          b64Data: entry.b64Data,
          pageKey: entry.pageKey,
          version: entry.version || "SUB",
          referer: YONAPLAY_ORIGIN + "/",
        });
        streams.push(...decoded);
      }
    }

    const unique = [];
    const seenUrls = new Set();
    for (const s of streams) {
      if (!s?.url || seenUrls.has(s.url)) continue;
      seenUrls.add(s.url);
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
EOF
