const MAIN_URL = "https://witanime.site";
const YONAPLAY_ORIGIN = "https://mid.yonaplay.net";
const REQUEST_TIMEOUT_MS = 4500;

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

const BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  Referer: MAIN_URL + "/",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const searchCache = new Map();
const episodesCache = new Map();

function fetchWithTimeout(url, options, timeoutMs) {
  const ms = timeoutMs || REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, ms);
  return fetch(url, Object.assign({}, options || {}, { signal: controller.signal }))
    .finally(function () {
      clearTimeout(timer);
    });
}

function toAbsUrl(raw, base) {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim().replace(/\\\//g, "/");
  if (!s) return "";
  if (s.indexOf("http://") === 0 || s.indexOf("https://") === 0) return s;
  if (s.indexOf("//") === 0) return "https:" + s;
  const root = (base || MAIN_URL).replace(/\/+$/, "");
  if (s.charAt(0) === "/") return root + s;
  return root + "/" + s.replace(/^\/+/, "");
}

function b64ToBytes(b64) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(b64 || "").replace(/[^A-Za-z0-9+/=]/g, "");
  const out = [];
  let i = 0;
  while (i < clean.length) {
    const c1 = chars.indexOf(clean.charAt(i++));
    const c2 = chars.indexOf(clean.charAt(i++));
    const c3ch = clean.charAt(i++);
    const c4ch = clean.charAt(i++);
    const c3 = c3ch === "=" ? 0 : chars.indexOf(c3ch);
    const c4 = c4ch === "=" ? 0 : chars.indexOf(c4ch);
    if (c1 < 0 || c2 < 0) break;
    out.push((c1 << 2) | (c2 >> 4));
    if (c3ch !== "=" && c3 >= 0) out.push(((c2 & 15) << 4) | (c3 >> 2));
    if (c4ch !== "=" && c4 >= 0) out.push(((c3 & 3) << 6) | c4);
  }
  return new Uint8Array(out);
}

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function sha256Pure(inputBytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const bitLen = inputBytes.length * 8;
  const paddedLen = Math.ceil((inputBytes.length + 9) / 64) * 64;
  const msg = new Uint8Array(paddedLen);
  msg.set(inputBytes);
  msg[inputBytes.length] = 0x80;

  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const dv = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, H[i], false);
  return digest;
}

function utf8ToBytes(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(String(str));
  }
  const s = unescape(encodeURIComponent(String(str)));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function bytesToUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(s));
}

async function decryptYonaPlayAesGcm(b64Data, pageKey) {
  if (!b64Data || !pageKey) return null;
  try {
    if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
    const keyBytes = sha256Pure(utf8ToBytes(pageKey));
    const raw = b64ToBytes(b64Data);
    if (raw.length <= 28) return null;

    const iv = raw.slice(0, 12);
    const tag = raw.slice(12, 28);
    const cipherText = raw.slice(28);

    const combined = new Uint8Array(cipherText.length + tag.length);
    combined.set(cipherText, 0);
    combined.set(tag, cipherText.length);

    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const plainBuf = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv, tagLength: 128 },
      cryptoKey,
      combined
    );
    return bytesToUtf8(new Uint8Array(plainBuf)).trim();
  } catch (err) {
    return null;
  }
}

function normalizeQuality(q) {
  const u = String(q || "").toUpperCase();
  if (u.indexOf("4K") >= 0 || u.indexOf("2160") >= 0) return "2160p";
  if (u.indexOf("FHD") >= 0 || u.indexOf("1080") >= 0) return "1080p";
  if (u.indexOf("HD") >= 0 || u.indexOf("720") >= 0) return "720p";
  if (u.indexOf("SD") >= 0 || u.indexOf("480") >= 0) return "480p";
  return q || "Auto";
}

function parseQuery(rawId, mediaType, episode) {
  const isMovie = mediaType === "movie";
  const parsedEp = Number(episode);
  const epNum = isMovie ? 1 : parsedEp > 0 ? parsedEp : 1;
  const s = String(rawId || "").trim();
  let query = s;
  if (/^(tmdb|imdb|mal|kitsu)[:\-]/i.test(s) || /^tt\d+$/i.test(s)) {
    query = s.split(":")[0].replace(/^(tmdb|mal|kitsu)[:\-]/i, "").trim();
  }
  return { query: query, epNum: epNum };
}

async function getStreams(id, mediaType, season, episode) {
  try {
    if (id && typeof id === "object" && id.b64Data && id.pageKey) {
      const plain = await decryptYonaPlayAesGcm(id.b64Data, id.pageKey);
      if (!plain) return [];
      const ver = String(id.version || "SUB").toUpperCase();
      const headers = {
        "User-Agent": USER_AGENT,
        Referer: toAbsUrl(id.referer, YONAPLAY_ORIGIN) || YONAPLAY_ORIGIN + "/",
      };
      if (/^https?:\/\//i.test(plain)) {
        return [
          {
            name: "WitAnime (" + ver + ")",
            title: "YonaPlay · " + ver + " · Auto",
            quality: "Auto",
            url: plain,
            headers: headers,
            subtitles: [],
          },
        ];
      }
      const parsed = JSON.parse(plain);
      const subs = [];
      const subUrl = parsed && (parsed.subUrl || parsed.subtitle || parsed.sub);
      if (typeof subUrl === "string" && subUrl.trim()) {
        const lang = String(parsed.subLang || "ar").toLowerCase();
        const label = parsed.subLabel || "Arabic";
        subs.push({
          id: "witanime-sub-0",
          name: label,
          lang: lang,
          language: label,
          label: label,
          url: toAbsUrl(subUrl, YONAPLAY_ORIGIN),
        });
      }
      const pool =
        (parsed && (parsed.qualities || parsed.sources || parsed.streams)) ||
        parsed;
      const out = [];
      const seen = new Set();
      if (pool && typeof pool === "object") {
        const qKeys = Object.keys(pool);
        for (let i = 0; i < qKeys.length; i++) {
          const qKey = qKeys[i];
          const entry = pool[qKey];
          if (typeof entry === "string") {
            const full = toAbsUrl(entry, YONAPLAY_ORIGIN);
            if (full && /^https?:\/\//i.test(full) && !seen.has(full)) {
              seen.add(full);
              const qual = normalizeQuality(qKey);
              out.push({
                name: "WitAnime (" + ver + ")",
                title: "YonaPlay · " + ver + " · " + qual,
                quality: qual,
                url: full,
                headers: headers,
                subtitles: subs,
              });
            }
          } else if (entry && typeof entry === "object") {
            const sKeys = Object.keys(entry);
            for (let j = 0; j < sKeys.length; j++) {
              const srv = sKeys[j];
              const link = entry[srv];
              if (typeof link === "string") {
                const full = toAbsUrl(link, YONAPLAY_ORIGIN);
                if (full && /^https?:\/\//i.test(full) && !seen.has(full)) {
                  seen.add(full);
                  const qual = normalizeQuality(qKey);
                  out.push({
                    name: "WitAnime (" + ver + ")",
                    title: srv + " · " + ver + " · " + qual,
                    quality: qual,
                    url: full,
                    headers: headers,
                    subtitles: subs,
                  });
                }
              }
            }
          }
        }
      }
      return out;
    }

    const info = parseQuery(id, mediaType, episode);
    if (!info.query || /^\d+$/.test(info.query) || /^tt\d+$/i.test(info.query)) {
      return [];
    }

    const cacheKey = info.query.toLowerCase();
    let animeUrl = searchCache.get(cacheKey);
    if (!animeUrl) {
      const sUrl =
        MAIN_URL + "/?search_param=animes&s=" + encodeURIComponent(info.query);
      const sRes = await fetchWithTimeout(sUrl, { headers: BASE_HEADERS });
      if (!sRes.ok) return [];
      const sHtml = await sRes.text();
      const m = /href=["'](https?:\/\/witanime\.site\/anime\/[^"']+|\/anime\/[^"']+)["']/i.exec(
        sHtml
      );
      if (!m) return [];
      animeUrl = toAbsUrl(m[1], MAIN_URL);
      searchCache.set(cacheKey, animeUrl);
    }

    let epHtml = episodesCache.get(animeUrl);
    if (!epHtml) {
      const aRes = await fetchWithTimeout(animeUrl, { headers: BASE_HEADERS });
      if (!aRes.ok) return [];
      epHtml = await aRes.text();
      episodesCache.set(animeUrl, epHtml);
    }

    const re =
      /href=["'](https?:\/\/witanime\.site\/watch\/[^"']+|\/watch\/[^"']+)["']/gi;
    let watchUrl = "";
    let firstWatch = "";
    const targetSuffix = "/" + String(info.epNum);
    let match;
    while ((match = re.exec(epHtml)) !== null) {
      const full = toAbsUrl(match[1], MAIN_URL);
      if (!full || /\/(sources|stream-|download-|app-webview)/i.test(full)) {
        continue;
      }
      if (!firstWatch) firstWatch = full;
      if (full.replace(/\/+$/, "").endsWith(targetSuffix)) {
        watchUrl = full;
        break;
      }
    }
    watchUrl = watchUrl || firstWatch;
    if (!watchUrl) return [];

    const wRes = await fetchWithTimeout(watchUrl, { headers: BASE_HEADERS });
    if (!wRes.ok) return [];
    const wHtml = await wRes.text();
    const csrfMatch =
      /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i.exec(
        wHtml
      );
    const csrf = csrfMatch ? csrfMatch[1] : "";
    const srcMatch = /sourcesUrl\s*:\s*['"]([^'"]+)['"]/.exec(wHtml);
    const sourcesUrl = srcMatch
      ? toAbsUrl(srcMatch[1], MAIN_URL)
      : watchUrl.replace(/\/+$/, "") + "/sources";

    const cookies =
      typeof wRes.headers.getSetCookie === "function"
        ? wRes.headers
            .getSetCookie()
            .map(function (c) {
              return c.split(";")[0];
            })
            .filter(Boolean)
            .join("; ")
        : "";

    const postHeaders = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "X-CSRF-TOKEN": csrf,
      "X-Requested-With": "XMLHttpRequest",
      Origin: MAIN_URL,
      Referer: watchUrl,
    };
    if (cookies) postHeaders.Cookie = cookies;

    const pRes = await fetchWithTimeout(sourcesUrl, {
      method: "POST",
      headers: postHeaders,
    });
    if (!pRes.ok) return [];
    return [];
  } catch (err) {
    return [];
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
