const BASE_URL = "https://vivarium.st";
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY =
  (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ||
  "307b7b8ef035c6aa336900aef4e203bd";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

const PROVIDERS = [
  { key: "hades", label: "Hades", def: true },
  { key: "hemera", label: "Hemera", def: true },
  { key: "hyperion", label: "Hyperion", def: true },
  { key: "nyx", label: "Nyx", def: true },
  { key: "orion", label: "Orion", def: true },
  { key: "poseidon", label: "Poseidon", def: true },
  { key: "tethys", label: "Tethys", def: true },
  { key: "theia", label: "Theia", def: true },
  { key: "tyche", label: "Tyche", def: true },
];

const LANGUAGES = [
  { key: "lang_ar", code: "ar", label: "Arabic", def: true },
  { key: "lang_bn", code: "bn", label: "Bengali", def: true },
  { key: "lang_zh", code: "zh", label: "Chinese", def: true },
  { key: "lang_nl", code: "nl", label: "Dutch", def: true },
  { key: "lang_fr", code: "fr", label: "French", def: true },
  { key: "lang_de", code: "de", label: "German", def: true },
  { key: "lang_hi", code: "hi", label: "Hindi", def: true },
  { key: "lang_it", code: "it", label: "Italian", def: true },
  { key: "lang_ja", code: "ja", label: "Japanese", def: true },
  { key: "lang_kn", code: "kn", label: "Kannada", def: true },
  { key: "lang_ko", code: "ko", label: "Korean", def: true },
  { key: "lang_pl", code: "pl", label: "Polish", def: true },
  { key: "lang_pt", code: "pt", label: "Portuguese", def: true },
  { key: "lang_ru", code: "ru", label: "Russian", def: true },
  { key: "lang_es", code: "es", label: "Spanish", def: true },
  { key: "lang_ta", code: "ta", label: "Tamil", def: true },
  { key: "lang_te", code: "te", label: "Telugu", def: true },
  { key: "lang_tr", code: "tr", label: "Turkish", def: true },
];

const LANG_NAMES = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  fr: "French",
  de: "German",
  es: "Spanish",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  pt: "Portuguese",
  ru: "Russian",
  it: "Italian",
  tr: "Turkish",
  pl: "Polish",
  nl: "Dutch",
  sv: "Swedish",
  fi: "Finnish",
  da: "Danish",
  nb: "Norwegian",
  cs: "Czech",
  sk: "Slovak",
  hu: "Hungarian",
  ro: "Romanian",
  bg: "Bulgarian",
  hr: "Croatian",
  el: "Greek",
  he: "Hebrew",
  id: "Indonesian",
  ms: "Malay",
  th: "Thai",
  vi: "Vietnamese",
  uk: "Ukrainian",
  is: "Icelandic",
  et: "Estonian",
  lt: "Lithuanian",
  lv: "Latvian",
};

const RC256 = [
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

const tmdbCache = new Map();

function fetchWithTimeout(url, options, timeoutMs) {
  const opts = options || {};
  const ms = typeof timeoutMs === "number" ? timeoutMs : 6000;
  if (typeof AbortController === "undefined") {
    return fetch(url, opts).catch(function () {
      return null;
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, ms);
  return fetch(url, Object.assign({}, opts, { signal: controller.signal }))
    .catch(function () {
      return null;
    })
    .finally(function () {
      clearTimeout(timer);
    });
}

function parseIncomingId(rawId) {
  const s = String(rawId || "").trim();
  if (!s) return null;

  const prefixed = s.match(/^(tmdb|mal|myanimelist|kitsu|anilist|tvdb)[:_-](.+)$/i);
  if (prefixed) {
    return {
      source: prefixed[1].toLowerCase(),
      value: prefixed[2].trim(),
    };
  }

  if (/^tt\d+$/i.test(s)) {
    return { source: "imdb", value: s };
  }

  if (/^\d+$/.test(s)) {
    return { source: "numeric", value: s };
  }

  return { source: "other", value: s };
}

function normalizeQuery(id, mediaType, season, episode) {
  const parsed = parseIncomingId(id);
  if (!parsed || !parsed.value) return null;

  const isTv =
    mediaType === "tv" ||
    mediaType === "series" ||
    mediaType === "anime" ||
    mediaType === "show";
  const sNum = Number(season) > 0 ? Number(season) : 1;
  const eNum = isTv ? (Number(episode) > 0 ? Number(episode) : 1) : 1;

  return {
    source: parsed.source,
    value: parsed.value,
    isTv: isTv,
    season: sNum,
    episode: eNum,
  };
}

function findTmdbIdFromExternal(source, value, isTv) {
  const cacheKey = source + ":" + value + ":" + (isTv ? "tv" : "movie");
  if (tmdbCache.has(cacheKey)) {
    return Promise.resolve(tmdbCache.get(cacheKey));
  }

  function saveAndReturn(val) {
    if (val) tmdbCache.set(cacheKey, String(val));
    return val ? String(val) : null;
  }

  if (source === "imdb") {
    const url =
      TMDB_API_BASE +
      "/find/" +
      encodeURIComponent(value) +
      "?api_key=" +
      encodeURIComponent(TMDB_KEY) +
      "&external_source=imdb_id";
    return fetchWithTimeout(url, {}, 5000)
      .then(function (r) {
        return r && r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data) return null;
        const list = isTv
          ? data.tv_results || data.movie_results || []
          : data.movie_results || data.tv_results || [];
        return saveAndReturn(list[0] && list[0].id);
      })
      .catch(function () {
        return null;
      });
  }

  if (source === "tvdb") {
    const url =
      TMDB_API_BASE +
      "/find/" +
      encodeURIComponent(value) +
      "?api_key=" +
      encodeURIComponent(TMDB_KEY) +
      "&external_source=tvdb_id";
    return fetchWithTimeout(url, {}, 5000)
      .then(function (r) {
        return r && r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data) return null;
        const list = data.tv_results || data.movie_results || [];
        return saveAndReturn(list[0] && list[0].id);
      })
      .catch(function () {
        return null;
      });
  }

  if (source === "mal" || source === "myanimelist" || source === "anilist" || source === "kitsu") {
    let metaPromise;
    if (source === "mal" || source === "myanimelist") {
      metaPromise = fetchWithTimeout(
        "https://api.jikan.moe/v4/anime/" + encodeURIComponent(value),
        {},
        5000
      )
        .then(function (r) {
          return r && r.ok ? r.json() : null;
        })
        .then(function (j) {
          const d = j && j.data;
          if (!d) return null;
          return {
            title: d.title_english || d.title || "",
            year: (d.year || (d.aired && d.aired.prop && d.aired.prop.from && d.aired.prop.from.year) || ""),
          };
        });
    } else if (source === "anilist") {
      const gql = JSON.stringify({
        query:
          "query ($id: Int) { Media(id: $id, type: ANIME) { title { english romaji } seasonYear } }",
        variables: { id: Number(value) },
      });
      metaPromise = fetchWithTimeout(
        "https://graphql.anilist.co",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: gql,
        },
        5000
      )
        .then(function (r) {
          return r && r.ok ? r.json() : null;
        })
        .then(function (g) {
          const m = g && g.data && g.data.Media;
          if (!m) return null;
          return {
            title: (m.title && (m.title.english || m.title.romaji)) || "",
            year: m.seasonYear || "",
          };
        });
    } else {
      metaPromise = fetchWithTimeout(
        "https://kitsu.io/api/edge/anime/" + encodeURIComponent(value),
        { headers: { Accept: "application/vnd.api+json" } },
        5000
      )
        .then(function (r) {
          return r && r.ok ? r.json() : null;
        })
        .then(function (k) {
          const attr = k && k.data && k.data.attributes;
          if (!attr) return null;
          const titles = attr.titles || {};
          return {
            title: titles.en || titles.en_jp || attr.canonicalTitle || "",
            year: attr.startDate ? String(attr.startDate).slice(0, 4) : "",
          };
        });
    }

    return metaPromise
      .then(function (info) {
        if (!info || !info.title) return null;
        const endpoint = isTv ? "tv" : "movie";
        const yearParam = info.year
          ? isTv
            ? "&first_air_date_year=" + encodeURIComponent(info.year)
            : "&year=" + encodeURIComponent(info.year)
          : "";
        const searchUrl =
          TMDB_API_BASE +
          "/search/" +
          endpoint +
          "?api_key=" +
          encodeURIComponent(TMDB_KEY) +
          "&query=" +
          encodeURIComponent(info.title) +
          yearParam;
        return fetchWithTimeout(searchUrl, {}, 5000)
          .then(function (r) {
            return r && r.ok ? r.json() : null;
          })
          .then(function (s) {
            const first = s && s.results && s.results[0];
            if (first && first.id) return saveAndReturn(first.id);
            if (!info.year) return null;
            const fallbackUrl =
              TMDB_API_BASE +
              "/search/" +
              endpoint +
              "?api_key=" +
              encodeURIComponent(TMDB_KEY) +
              "&query=" +
              encodeURIComponent(info.title);
            return fetchWithTimeout(fallbackUrl, {}, 5000)
              .then(function (r2) {
                return r2 && r2.ok ? r2.json() : null;
              })
              .then(function (s2) {
                const f2 = s2 && s2.results && s2.results[0];
                return saveAndReturn(f2 && f2.id);
              });
          });
      })
      .catch(function () {
        return null;
      });
  }

  return Promise.resolve(null);
}

function resolveTmdbId(q) {
  if (q.source === "tmdb" || q.source === "numeric") {
    return /^\d+$/.test(q.value) ? Promise.resolve(q.value) : Promise.resolve(null);
  }
  return findTmdbIdFromExternal(q.source, q.value, q.isTv);
}

function stableSort(items, compare) {
  return items
    .map(function (item, index) {
      return { item: item, index: index };
    })
    .sort(function (a, b) {
      return compare(a.item, b.item) || a.index - b.index;
    })
    .map(function (entry) {
      return entry.item;
    });
}

function readSettings() {
  return (typeof SCRAPER_SETTINGS !== "undefined" && SCRAPER_SETTINGS) || {};
}

function enabledProviders() {
  const settings = readSettings();
  const enabled = [];
  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i];
    if (settings[p.key] === undefined ? !!p.def : settings[p.key] === true) {
      enabled.push(p.label.toLowerCase());
    }
  }
  return enabled;
}

function enabledLanguages() {
  const settings = readSettings();
  const enabled = [];
  for (let i = 0; i < LANGUAGES.length; i++) {
    const l = LANGUAGES[i];
    if (settings[l.key] === undefined ? !!l.def : settings[l.key] === true) {
      enabled.push(l.code);
    }
  }
  return enabled;
}

function encodeUtf8(text) {
  const bytes = [];
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    let codePoint = s.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint < 0xdc00 && i + 1 < s.length) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (codePoint < 0x80) bytes.push(codePoint);
    else if (codePoint < 0x800)
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 63));
    else if (codePoint < 0x10000)
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 63),
        0x80 | (codePoint & 63)
      );
    else
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 63),
        0x80 | ((codePoint >> 6) & 63),
        0x80 | (codePoint & 63)
      );
  }
  return bytes;
}

function sha256Digest(input) {
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const byteLength = input.length;
  const bitLengthHigh = Math.floor(byteLength / 0x20000000);
  const bitLengthLow = (byteLength << 3) >>> 0;
  const padded = input.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  padded.push(
    (bitLengthHigh >>> 24) & 255,
    (bitLengthHigh >>> 16) & 255,
    (bitLengthHigh >>> 8) & 255,
    bitLengthHigh & 255,
    (bitLengthLow >>> 24) & 255,
    (bitLengthLow >>> 16) & 255,
    (bitLengthLow >>> 8) & 255,
    bitLengthLow & 255
  );

  const schedule = new Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    let round;
    for (round = 0; round < 16; round++) {
      const base = offset + round * 4;
      schedule[round] =
        ((padded[base] << 24) |
          (padded[base + 1] << 16) |
          (padded[base + 2] << 8) |
          padded[base + 3]) |
        0;
    }
    for (round = 16; round < 64; round++) {
      const early = schedule[round - 15];
      const late = schedule[round - 2];
      const sigma0 =
        ((early >>> 7) | (early << 25)) ^
        ((early >>> 18) | (early << 14)) ^
        (early >>> 3);
      const sigma1 =
        ((late >>> 17) | (late << 15)) ^
        ((late >>> 19) | (late << 13)) ^
        (late >>> 10);
      schedule[round] =
        (schedule[round - 16] + sigma0 + schedule[round - 7] + sigma1) | 0;
    }

    let a = state[0],
      b = state[1],
      c = state[2],
      d = state[3],
      e = state[4],
      f = state[5],
      g = state[6],
      h = state[7];
    for (round = 0; round < 64; round++) {
      const bigSigma1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + bigSigma1 + choice + RC256[round] + schedule[round]) | 0;
      const bigSigma0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigma0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    state[0] = (state[0] + a) | 0;
    state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0;
    state[3] = (state[3] + d) | 0;
    state[4] = (state[4] + e) | 0;
    state[5] = (state[5] + f) | 0;
    state[6] = (state[6] + g) | 0;
    state[7] = (state[7] + h) | 0;
  }

  const digest = [];
  for (let i = 0; i < 8; i++) {
    digest.push(
      (state[i] >>> 24) & 255,
      (state[i] >>> 16) & 255,
      (state[i] >>> 8) & 255,
      state[i] & 255
    );
  }
  return digest;
}

const HMAC_KEY_BYTES = encodeUtf8(
  "6af5200a03de9a234734d3ef385c84490dc4164881e408450b6c35973803bded"
);

function buildPad(mask) {
  const pad = [];
  for (let i = 0; i < 64; i++) {
    const keyByte = i < HMAC_KEY_BYTES.length ? HMAC_KEY_BYTES[i] : 0;
    pad.push(keyByte ^ mask);
  }
  return pad;
}

const HMAC_INNER_PAD = buildPad(0x36);
const HMAC_OUTER_PAD = buildPad(0x5c);

function hmacSha256Hex(messageBytes) {
  const mac = sha256Digest(
    HMAC_OUTER_PAD.concat(sha256Digest(HMAC_INNER_PAD.concat(messageBytes)))
  );
  let hex = "";
  for (let i = 0; i < mac.length; i++) {
    hex += (mac[i] < 16 ? "0" : "") + mac[i].toString(16);
  }
  return hex;
}

function signRequest(method, pathAndQuery, timestamp, nonce) {
  const message =
    method.toUpperCase() +
    "\n" +
    pathAndQuery +
    "\n" +
    timestamp +
    (nonce ? "\n" + nonce : "") +
    "\n" +
    "51e87f5e8e951aa213fe48de7478cc0bf0e06b4eaa53cd948f97afd1b5f2b596";
  return hmacSha256Hex(encodeUtf8(message));
}

function defaultHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Referer: BASE_URL + "/",
    Accept: "*/*",
  };
}

function createRunner() {
  let serverClockOffsetMs = 0;

  function syncServerClock(response) {
    try {
      const dateHeader =
        response && response.headers && response.headers.get("date");
      if (dateHeader) {
        const serverTime = Date.parse(dateHeader);
        if (!isNaN(serverTime)) serverClockOffsetMs = serverTime - Date.now();
      }
    } catch (_) {}
  }

  function getUnsigned(path) {
    return Promise.resolve()
      .then(function () {
        return fetchWithTimeout(BASE_URL + path, { headers: defaultHeaders() }, 5000);
      })
      .then(function (response) {
        syncServerClock(response);
        return response;
      });
  }

  function getSigned(path, nonce) {
    const timestamp = String(
      Math.floor((Date.now() + serverClockOffsetMs) / 1000)
    );
    const headers = defaultHeaders();
    headers["x-ts"] = timestamp;
    headers["x-cv"] = "94092f52501e";
    if (nonce) headers["x-nonce"] = nonce;
    headers["x-sig"] = signRequest("GET", path, timestamp, nonce || "");
    return fetchWithTimeout(BASE_URL + path, { headers: headers }, 7000);
  }

  function fetchNonces() {
    return getUnsigned("/api/n").then(function (response) {
      if (!response || !response.ok) return [];
      return response
        .json()
        .then(function (nonces) {
          return Array.isArray(nonces) ? nonces : [];
        })
        .catch(function () {
          return [];
        });
    });
  }

  function fetchEventStream(queryString, nonce) {
    return getSigned("/api/es?" + queryString, nonce || "").then(function (
      response
    ) {
      if (!response || !response.ok) return "";
      return response.text().catch(function () {
        return "";
      });
    });
  }

  return {
    fetchNonces: fetchNonces,
    fetchEventStream: fetchEventStream,
  };
}

function parseServerSentEvents(text) {
  const events = [];
  const blocks = String(text || "").split(/\r?\n\r?\n/);
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i]) continue;
    const event = { event: "message", data: "" };
    const lines = blocks[i].split(/\r?\n/);
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) continue;
      const field = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1).replace(/^ /, "");
      if (field === "event") event.event = value;
      else if (field === "data")
        event.data += (event.data ? "\n" : "") + value;
    }
    events.push(event);
  }
  return events;
}

function toAbsoluteUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (url.charAt(0) === "/") return BASE_URL + url;
  return BASE_URL + "/" + url;
}

function langName(code) {
  return LANG_NAMES[code] || String(code || "").toUpperCase();
}

function extractCandidates(events) {
  const candidates = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].event !== "source") continue;
    let payload;
    try {
      payload = JSON.parse(events[i].data);
    } catch (_) {
      continue;
    }
    const sources = (payload && payload.streams) || [];
    for (let j = 0; j < sources.length; j++) {
      const source = sources[j];
      if (!source || !source.url) continue;

      const inlineSubs = [];
      if (Array.isArray(source.subs)) {
        for (let k = 0; k < source.subs.length; k++) {
          const sub = source.subs[k];
          if (sub && sub.url && sub.lang) {
            inlineSubs.push({
              url: toAbsoluteUrl(sub.url),
              label: sub.label || langName(sub.lang),
              language: sub.lang,
            });
          }
        }
      }

      candidates.push({
        url: toAbsoluteUrl(String(source.url)),
        quality: String(source.quality || "Auto"),
        provider: String(
          source.provider || (payload && payload.provider) || "?"
        ),
        rank: +source.rank || 0,
        type: String(source.type || "hls"),
        hevc: !!source.hevc,
        hdr: !!source.hdr,
        optional: !!source.opt,
        pinned: !!source.pin,
        lang: String(source.lang || "en"),
        dub: !!source.dub,
        inlineSubs: inlineSubs,
      });
    }
  }
  return candidates;
}

function scoreCandidate(candidate) {
  let score = candidate.rank || 720;
  if (candidate.optional) score -= 1200;
  if (candidate.hevc) score -= 150;
  if (candidate.hdr) score -= 100;
  if (candidate.pinned) score += 500;
  if (candidate.type !== "hls") score -= 100;
  return score;
}

function resolutionLabel(candidate) {
  const match = /(\d{3,4})\s*p/i.exec(candidate.quality);
  if (match) return match[1] + "p";
  return candidate.rank >= 1000 ? candidate.rank + "p" : "Auto";
}

function resolutionHeight(candidate) {
  const match = /(\d{3,4})/.exec(resolutionLabel(candidate));
  return match ? +match[1] : candidate.rank || 0;
}

function resolutionTier(candidate) {
  const height = resolutionHeight(candidate);
  if (height >= 1800) return 5;
  if (height >= 900) return 4;
  if (height >= 600) return 3;
  if (height >= 420) return 2;
  if (height >= 300) return 1;
  return 0;
}

function buildSortTag(tier, maxTier) {
  const inverted = Math.max(0, maxTier - tier);
  let bits = inverted.toString(2);
  while (bits.length < 20) bits = "0" + bits;
  return bits
    .split("")
    .map(function (bit) {
      return bit === "1" ? "\uFEFF" : "\u200B";
    })
    .join("");
}

function buildStream(candidate, label, subtitles, langLabel) {
  const sortTag = buildSortTag(resolutionTier(candidate), 6);
  const displayName =
    "Vivarium \u2022 " + (langLabel || label || candidate.provider);
  return {
    name: sortTag + displayName,
    title: sortTag + displayName,
    url: candidate.url,
    quality: resolutionLabel(candidate),
    headers: { Referer: BASE_URL + "/", "User-Agent": USER_AGENT },
    subtitles: subtitles,
  };
}

function pushGroup(streams, seenUrls, candidates, subtitles, langLabel) {
  const fresh = [];
  for (let i = 0; i < candidates.length; i++) {
    if (seenUrls[candidates[i].url]) continue;
    seenUrls[candidates[i].url] = true;
    fresh.push(candidates[i]);
  }
  if (!fresh.length) return false;

  let best = fresh[0];
  for (let j = 1; j < fresh.length; j++) {
    if (scoreCandidate(fresh[j]) > scoreCandidate(best)) best = fresh[j];
  }

  const sorted = stableSort(fresh, function (a, b) {
    return (
      resolutionHeight(b) - resolutionHeight(a) ||
      scoreCandidate(b) - scoreCandidate(a)
    );
  });
  for (let k = 0; k < sorted.length; k++) {
    streams.push(
      buildStream(
        sorted[k],
        sorted[k] === best ? "Auto" : null,
        subtitles,
        langLabel
      )
    );
  }
  return true;
}

function getStreams(id, mediaType, season, episode) {
  const q = normalizeQuery(id, mediaType, season, episode);
  if (!q) return Promise.resolve([]);

  const allowedProviders = enabledProviders();
  const allowedLangs = enabledLanguages();
  if (allowedProviders.length === 0 && allowedLangs.length === 0) {
    return Promise.resolve([]);
  }

  return resolveTmdbId(q)
    .then(function (tmdbId) {
      if (!tmdbId) return [];

      const runner = createRunner();
      const baseQuery =
        "id=" +
        encodeURIComponent(tmdbId) +
        "&type=" +
        (q.isTv ? "tv" : "movie") +
        (q.isTv ? "&s=" + q.season + "&e=" + q.episode : "");

      return runner.fetchNonces().then(function (nonces) {
        let nonceIndex = 0;
        return runner
          .fetchEventStream(baseQuery, nonces[nonceIndex++] || "")
          .then(function (baseEventText) {
            const allBaseCandidates = extractCandidates(
              parseServerSentEvents(baseEventText)
            );
            if (!allBaseCandidates.length) return [];

            const streams = [];
            const seenUrls = Object.create(null);

            let englishSubs = [];
            if (allowedProviders.length > 0) {
              let engCandidates = allBaseCandidates.filter(function (c) {
                return (
                  !c.dub &&
                  allowedProviders.indexOf(c.provider.toLowerCase()) !== -1
                );
              });
              if (engCandidates.length > 0) {
                engCandidates = stableSort(engCandidates, function (a, b) {
                  return scoreCandidate(b) - scoreCandidate(a);
                });
                englishSubs = engCandidates[0].inlineSubs;
                pushGroup(streams, seenUrls, engCandidates, englishSubs, null);
              }
            }

            if (allowedLangs.length === 0) return streams;

            const coveredDubLangs = [];
            const dubGroups = Object.create(null);
            const baseDubLangs = [];
            for (let i = 0; i < allBaseCandidates.length; i++) {
              const c = allBaseCandidates[i];
              if (!c.dub || allowedLangs.indexOf(c.lang) === -1) continue;
              if (!dubGroups[c.lang]) {
                dubGroups[c.lang] = [];
                baseDubLangs.push(c.lang);
              }
              dubGroups[c.lang].push(c);
            }
            for (let j = 0; j < baseDubLangs.length; j++) {
              const lang = baseDubLangs[j];
              if (
                pushGroup(
                  streams,
                  seenUrls,
                  dubGroups[lang],
                  englishSubs,
                  langName(lang)
                )
              ) {
                coveredDubLangs.push(lang);
              }
            }

            const missingDubLangs = allowedLangs.filter(function (code) {
              return coveredDubLangs.indexOf(code) === -1;
            });
            if (missingDubLangs.length === 0) return streams;

            return Promise.all(
              missingDubLangs.map(function (code) {
                return runner.fetchEventStream(
                  baseQuery + "&dubs=1&al=" + encodeURIComponent(code),
                  nonces[nonceIndex++] || ""
                );
              })
            ).then(function (dubEventTexts) {
              for (let d = 0; d < missingDubLangs.length; d++) {
                const dubLang = missingDubLangs[d];
                const dubCandidates = extractCandidates(
                  parseServerSentEvents(dubEventTexts[d])
                ).filter(function (candidate) {
                  return candidate.dub && candidate.lang === dubLang;
                });
                pushGroup(
                  streams,
                  seenUrls,
                  dubCandidates,
                  englishSubs,
                  langName(dubLang)
                );
              }
              return streams;
            });
          });
      });
    })
    .catch(function () {
      return [];
    });
}

if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
