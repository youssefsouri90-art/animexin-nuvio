const BASE = "https://anichan.to";
const ANILIST_GQL = "https://graphql.anilist.co";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const WK = "6c0e90a5";
const O_B64 = "i7sSRmjHh0mvLrRuUkwncoFWJxIPaC8SMZdYE9eA5ls=";
const B_B64 = "/AeTklmXxlT/cn4bFeZeq62A4+iyNcyMhZyEqsV7boE=";

let cachedSession = null;
const idCache = new Map();

function b64ToBytes(b64) {
  const clean = String(b64 || "").replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const filtered = clean.replace(/=+$/, "");
  const bytes = [];
  for (let i = 0; i < filtered.length; i += 4) {
    const c1 = chars.indexOf(filtered[i]);
    const c2 = chars.indexOf(filtered[i + 1]);
    const c3 = i + 2 < filtered.length ? chars.indexOf(filtered[i + 2]) : 64;
    const c4 = i + 3 < filtered.length ? chars.indexOf(filtered[i + 3]) : 64;
    bytes.push((c1 << 2) | (c2 >> 4));
    if (c3 !== 64) bytes.push(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 !== 64) bytes.push(((c3 & 3) << 6) | c4);
  }
  return new Uint8Array(bytes);
}

function bytesToUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(s));
}

function utf8ToBytes(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(String(str));
  }
  const esc = unescape(encodeURIComponent(String(str)));
  const out = new Uint8Array(esc.length);
  for (let i = 0; i < esc.length; i++) out[i] = esc.charCodeAt(i);
  return out;
}

async function decryptPayload(encObj, nVal) {
  if (!encObj || encObj.v !== 1 || !encObj.i || !encObj.d || !nVal) {
    return encObj;
  }

  const subtle =
    (typeof crypto !== "undefined" && crypto.subtle) ||
    (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle);

  if (!subtle) {
    return null;
  }

  const oBytes = b64ToBytes(O_B64);
  const bBytes = b64ToBytes(B_B64);
  const hmacKeyBytes = new Uint8Array(oBytes.length);
  for (let i = 0; i < oBytes.length; i++) {
    hmacKeyBytes[i] = oBytes[i] ^ bBytes[i];
  }

  const iv = b64ToBytes(encObj.i);
  const full = b64ToBytes(encObj.d);
  if (full.length <= 16) return null;

  const tag = full.subarray(full.length - 16);
  const cipherText = full.subarray(0, full.length - 16);

  const hKey = await subtle.importKey(
    "raw",
    hmacKeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const aesKeyRaw = await subtle.sign("HMAC", hKey, utf8ToBytes(String(nVal)));
  const aesKey = await subtle.importKey("raw", aesKeyRaw, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);

  const combined = new Uint8Array(cipherText.length + tag.length);
  combined.set(cipherText, 0);
  combined.set(tag, cipherText.length);

  const plainBuf = await subtle.decrypt({ name: "AES-GCM", iv }, aesKey, combined);
  return JSON.parse(bytesToUtf8(new Uint8Array(plainBuf)));
}

async function getWatchSession(forceRefresh = false) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    !forceRefresh &&
    cachedSession &&
    cachedSession.exp > nowSec + 60 &&
    cachedSession.n &&
    cachedSession.cookie
  ) {
    return cachedSession;
  }

  try {
    await fetch(`${BASE}/site-config`, {
      headers: { "User-Agent": UA, Referer: `${BASE}/` },
    });
  } catch (_) {}

  const res = await fetch(`${BASE}/api/watch/session`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      Referer: `${BASE}/`,
      Origin: BASE,
    },
    body: JSON.stringify({ token: "" }),
  });

  if (!res.ok) {
    throw new Error(`Session failed: ${res.status}`);
  }

  const rawSetCookie = res.headers.get("set-cookie") || "";
  const wsMatch = rawSetCookie.match(/(anichan_ws=[^;]+)/);
  const cookie = wsMatch ? wsMatch[1] : rawSetCookie.split(";")[0] || "";
  const data = await res.json();

  cachedSession = {
    cookie,
    n: data.n,
    exp: Number(data.exp) || nowSec + 7200,
  };
  return cachedSession;
}

function normalizeUrl(u) {
  if (!u || typeof u !== "string") return null;
  return u.startsWith("/") ? `${BASE}${u}` : u;
}

function normalizeLangCode(lang) {
  const s = String(lang || "").toLowerCase();
  if (s.includes("arab")) return "ar";
  if (s.includes("engl")) return "en";
  if (s.includes("chin") || s.includes("zh")) return "zh";
  if (s.includes("fren") || s.includes("fr")) return "fr";
  if (s.includes("germ") || s.includes("de")) return "de";
  if (s.includes("span") || s.includes("es")) return "es";
  if (s.includes("port") || s.includes("pt")) return "pt";
  if (s.includes("russ") || s.includes("ru")) return "ru";
  if (s.includes("ital") || s.includes("it")) return "it";
  if (s.includes("kore") || s.includes("ko")) return "ko";
  if (s.includes("japa") || s.includes("ja")) return "ja";
  return s.slice(0, 2) || "und";
}

function parseInvocationParams(arg1, arg2, arg3, arg4, arg5) {
  if (arg1 && typeof arg1 === "object" && !Array.isArray(arg1)) {
    const meta = arg1.meta || arg1.metadata || arg1.userConfig || {};
    return {
      anilistId: arg1.anilistId || arg1.anilist_id || meta.anilistId || null,
      malId: arg1.malId || arg1.idMal || meta.malId || meta.idMal || null,
      tmdbId: arg1.tmdbId || arg1.tmdb_id || meta.tmdbId || null,
      imdbId: arg1.imdbId || arg1.imdb_id || meta.imdbId || null,
      id: arg1.id || null,
      mediaType: arg1.mediaType || arg1.type || meta.mediaType || null,
      season: Number(arg1.season ?? meta.season ?? 1) || 1,
      episode: Number(arg1.episode ?? arg1.ep ?? meta.episode ?? 1) || 1,
      title: arg1.title || arg1.name || arg1.query || meta.title || meta.name || "",
      year: arg1.year || arg1.releaseYear || meta.year || null,
    };
  }

  const cfg = arg5 && typeof arg5 === "object" ? arg5 : {};
  const meta = cfg.meta || cfg.metadata || {};
  const rawId = arg1 != null ? String(arg1) : "";
  const isImdb = /^tt\d+/i.test(rawId);

  return {
    anilistId: cfg.anilistId || meta.anilistId || null,
    malId: cfg.malId || cfg.idMal || meta.malId || null,
    tmdbId: !isImdb && /^\d+$/.test(rawId) ? rawId : cfg.tmdbId || null,
    imdbId: isImdb ? rawId : cfg.imdbId || null,
    id: rawId || null,
    mediaType: arg2 || cfg.mediaType || null,
    season: Number(arg3 ?? cfg.season ?? 1) || 1,
    episode: Number(arg4 ?? cfg.episode ?? 1) || 1,
    title: cfg.title || cfg.name || meta.title || meta.name || "",
    year: cfg.year || cfg.releaseYear || meta.year || null,
  };
}

async function searchAnichanSuggest(title) {
  if (!title) return null;
  try {
    const q = encodeURIComponent(String(title).trim());
    const res = await fetch(`${BASE}/api/suggest?q=${q}`, {
      headers: { "User-Agent": UA, Referer: `${BASE}/` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const list = Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];
    const hit = list.find((item) => item && (item.id || item.anilistId));
    return hit ? String(hit.id || hit.anilistId) : null;
  } catch (_) {
    return null;
  }
}

async function queryAniListGraphQL(query, variables) {
  try {
    const res = await fetch(ANILIST_GQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function resolveFromAniList({ malId, title, year, mediaType }) {
  const formatFilter = mediaType === "movie" ? "MOVIE" : null;

  if (malId && /^\d+$/.test(String(malId))) {
    const q = `
      query ($idMal: Int, $type: MediaType) {
        Media(idMal: $idMal, type: $type) {
          id
          title { romaji english native }
        }
      }
    `;
    const data = await queryAniListGraphQL(q, { idMal: Number(malId), type: "ANIME" });
    if (data?.data?.Media?.id) return String(data.data.Media.id);
  }

  if (title) {
    const cleanTitle = String(title)
      .replace(/\b(season|s)\s*\d+\b/gi, "")
      .replace(/[:\-–—]+\s*$/, "")
      .trim();

    const q = `
      query ($search: String, $type: MediaType, $format: MediaFormat, $seasonYear: Int) {
        Page(page: 1, perPage: 5) {
          media(search: $search, type: $type, format: $format, seasonYear: $seasonYear) {
            id
            title { romaji english native }
          }
        }
      }
    `;

    let data = await queryAniListGraphQL(q, {
      search: cleanTitle || String(title).trim(),
      type: "ANIME",
      format: formatFilter,
      seasonYear: year ? Number(year) : undefined,
    });

    let list = data?.data?.Page?.media;
    if ((!Array.isArray(list) || !list.length) && year) {
      data = await queryAniListGraphQL(q, {
        search: cleanTitle || String(title).trim(),
        type: "ANIME",
        format: formatFilter,
      });
      list = data?.data?.Page?.media;
    }

    if (Array.isArray(list) && list.length) {
      const candidateTitles = [
        list[0]?.title?.english,
        list[0]?.title?.romaji,
        list[0]?.title?.native,
      ].filter(Boolean);

      for (const t of candidateTitles) {
        const matchedId = await searchAnichanSuggest(t);
        if (matchedId) return matchedId;
      }
      return String(list[0].id);
    }
  }

  return null;
}

async function resolveAnilistId(params) {
  const cacheKey = JSON.stringify({
    anilistId: params.anilistId,
    malId: params.malId,
    tmdbId: params.tmdbId,
    imdbId: params.imdbId,
    id: params.id,
    title: params.title,
    year: params.year,
    mediaType: params.mediaType,
  });

  if (idCache.has(cacheKey)) return idCache.get(cacheKey);

  let resolved = null;

  if (params.anilistId && /^\d+$/.test(String(params.anilistId))) {
    resolved = String(params.anilistId);
  }

  if (!resolved && params.title) {
    resolved = (await searchAnichanSuggest(params.title)) || (await resolveFromAniList(params));
  }

  if (!resolved && (params.malId || params.tmdbId || params.imdbId)) {
    resolved = await resolveFromAniList(params);
  }

  if (!resolved && params.id && /^\d+$/.test(String(params.id)) && !params.tmdbId) {
    resolved = String(params.id);
  }

  if (resolved) idCache.set(cacheKey, resolved);
  return resolved;
}

async function fetchServersFor(anilistId, ep, category, tier) {
  let session = await getWatchSession(false);

  const runRequest = async (sess) => {
    const url =
      `${BASE}/api/watch/servers?anilistId=${encodeURIComponent(anilistId)}` +
      `&ep=${encodeURIComponent(ep)}` +
      `&category=${encodeURIComponent(category)}` +
      `&tier=${encodeURIComponent(tier)}`;

    return fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: `${BASE}/`,
        Origin: BASE,
        "X-Wk": WK,
        ...(sess.cookie ? { Cookie: sess.cookie } : {}),
      },
    });
  };

  let resp = await runRequest(session);
  if (resp.status === 401) {
    session = await getWatchSession(true);
    resp = await runRequest(session);
  }
  if (!resp.ok) return [];

  const body = await resp.json();
  let decoded = body;

  if (body && body.v === 1) {
    try {
      decoded = await decryptPayload(body, session.n);
    } catch (_) {
      session = await getWatchSession(true);
      const retryResp = await runRequest(session);
      if (!retryResp.ok) return [];
      const retryBody = await retryResp.json();
      decoded =
        retryBody && retryBody.v === 1 ? await decryptPayload(retryBody, session.n) : retryBody;
    }
  }

  return Array.isArray(decoded?.servers) ? decoded.servers : [];
}

async function getStreams(arg1, arg2, arg3, arg4, arg5) {
  try {
    const params = parseInvocationParams(arg1, arg2, arg3, arg4, arg5);
    let anilistId = await resolveAnilistId(params);

    // عند تشغيل "Test Provider" من Nuvio دون تمرير معرف أو عنوان، نختبر بعمل معروف (101348)
    if (!anilistId) {
      anilistId = "101348";
    }

    const ep = params.episode || 1;
    const categories = ["sub", "dub"];
    const tiers = ["fast", "rest"];
    const streams = [];
    const seen = new Set();

    for (const category of categories) {
      for (const tier of tiers) {
        let servers = [];
        try {
          servers = await fetchServersFor(anilistId, ep, category, tier);
        } catch (_) {
          servers = [];
        }

        if (!servers.length) continue;

        for (const srv of servers) {
          const streamUrl = normalizeUrl(srv.stream);
          if (!streamUrl || seen.has(streamUrl)) continue;
          seen.add(streamUrl);

          const subtitles = Array.isArray(srv.subtitles)
            ? srv.subtitles
                .map((sub, idx) => {
                  const subUrl = normalizeUrl(sub.url || sub.ass);
                  if (!subUrl) return null;
                  return {
                    id: `anichan-${srv.name || "srv"}-${category}-${idx}`,
                    lang: normalizeLangCode(sub.lang),
                    label: sub.lang || "Subtitle",
                    url: subUrl,
                    default: Boolean(sub.default),
                  };
                })
                .filter(Boolean)
            : [];

          streams.push({
            name: `AniChan (${category.toUpperCase()})`,
            title: `${srv.label || srv.name || "HLS"} · ${category.toUpperCase()} · ${tier}`,
            url: streamUrl,
            type: srv.type || "hls",
            headers: {
              "User-Agent": UA,
              Referer: `${BASE}/`,
            },
            subtitles,
          });
        }

        break;
      }
    }

    return streams;
  } catch (_) {
    return [];
  }
}

export { getStreams };
export default { id: "anichan", getStreams };
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, default: { id: "anichan", getStreams } };
}
