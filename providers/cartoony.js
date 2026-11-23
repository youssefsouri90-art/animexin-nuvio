// Cartoony.js - Nuvio Provider (Pure JS AES-256-CBC, Arabic Dubbed Priority)

const BASE_URLS = ["https://cartoony.net", "https://carateen.tv"];
const VOD_ORIGIN = "https://vod.spacetoongo.com/asset";
const PEGASUS_ORIGIN = "https://pegasus.5387692.xyz/api/hls";
const KEY_STR = "7annaba3l_loves_crypto_safe_key!@";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://cartoony.net/",
  "Origin": "https://cartoony.net",
};

// --- Pure JS AES-256-CBC Decryption (No node:crypto dependency for Nuvio) ---
const SBOX = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
]);

const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

const RCON = new Uint8Array([0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36]);

function gmul(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function expandKey256(keyBytes) {
  const w = new Uint8Array(240);
  w.set(keyBytes.subarray(0, 32), 0);
  let bytesGenerated = 32;
  let rconIter = 1;
  const temp = new Uint8Array(4);

  while (bytesGenerated < 240) {
    for (let i = 0; i < 4; i++) temp[i] = w[bytesGenerated - 4 + i];
    if (bytesGenerated % 32 === 0) {
      const t = temp[0];
      temp[0] = SBOX[temp[1]] ^ RCON[rconIter++];
      temp[1] = SBOX[temp[2]];
      temp[2] = SBOX[temp[3]];
      temp[3] = SBOX[t];
    } else if (bytesGenerated % 32 === 16) {
      for (let i = 0; i < 4; i++) temp[i] = SBOX[temp[i]];
    }
    for (let i = 0; i < 4; i++) {
      w[bytesGenerated] = w[bytesGenerated - 32] ^ temp[i];
      bytesGenerated++;
    }
  }
  return w;
}

const EXPANDED_KEY = expandKey256(new TextEncoder().encode(KEY_STR));

function decryptBlock16(block, roundKeys) {
  const s = new Uint8Array(block);

  function addRoundKey(round) {
    const off = round * 16;
    for (let i = 0; i < 16; i++) s[i] ^= roundKeys[off + i];
  }

  function invShiftRows() {
    let t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
    t = s[2]; s[2] = s[10]; s[10] = t;
    t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
  }

  function invSubBytes() {
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
  }

  function invMixColumns() {
    for (let c = 0; c < 4; c++) {
      const i = c * 4;
      const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i]     = gmul(a0, 0x0e) ^ gmul(a1, 0x0b) ^ gmul(a2, 0x0d) ^ gmul(a3, 0x09);
      s[i + 1] = gmul(a0, 0x09) ^ gmul(a1, 0x0e) ^ gmul(a2, 0x0b) ^ gmul(a3, 0x0d);
      s[i + 2] = gmul(a0, 0x0d) ^ gmul(a1, 0x09) ^ gmul(a2, 0x0e) ^ gmul(a3, 0x0b);
      s[i + 3] = gmul(a0, 0x0b) ^ gmul(a1, 0x0d) ^ gmul(a2, 0x09) ^ gmul(a3, 0x0e);
    }
  }

  addRoundKey(14);
  for (let round = 13; round >= 1; round--) {
    invShiftRows();
    invSubBytes();
    addRoundKey(round);
    invMixColumns();
  }
  invShiftRows();
  invSubBytes();
  addRoundKey(0);
  return s;
}

function hexToBytes(hex) {
  const len = hex.length >> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function aes256CbcDecryptHex(ivHex, encHex) {
  const iv = hexToBytes(ivHex);
  const enc = hexToBytes(encHex);
  const out = new Uint8Array(enc.length);
  let prev = iv;

  for (let offset = 0; offset < enc.length; offset += 16) {
    const chunk = enc.subarray(offset, offset + 16);
    const dec = decryptBlock16(chunk, EXPANDED_KEY);
    for (let i = 0; i < 16; i++) {
      out[offset + i] = dec[i] ^ prev[i];
    }
    prev = chunk;
  }

  const pad = out[out.length - 1];
  const unpadded = pad > 0 && pad <= 16 ? out.subarray(0, out.length - pad) : out;
  return new TextDecoder("utf-8").decode(unpadded);
}

// --- Network & Catalog Helpers ---
let cachedCatalog = { ts: 0, base: BASE_URLS[0], shows: [] };

function fetchWithTimeout(url, options = {}, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function decryptPayload(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (!obj || typeof obj !== "object" || !obj.iv || !obj.encryptedData) {
    return obj;
  }
  try {
    const decrypted = aes256CbcDecryptHex(obj.iv, obj.encryptedData);
    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  } catch {
    return null;
  }
}

async function fetchJsonDecrypted(url, headers = DEFAULT_HEADERS) {
  try {
    const res = await fetchWithTimeout(url, { headers }, 6000);
    if (!res.ok) return null;
    const text = await res.text();
    return decryptPayload(text);
  } catch {
    return null;
  }
}

async function getCatalog() {
  const now = Date.now();
  if (cachedCatalog.shows.length > 0 && now - cachedCatalog.ts < 15 * 60 * 1000) {
    return cachedCatalog;
  }
  for (const base of BASE_URLS) {
    const data = await fetchJsonDecrypted(`${base}/api/sp/tvshows`);
    if (Array.isArray(data) && data.length > 0) {
      cachedCatalog = { ts: now, base, shows: data };
      return cachedCatalog;
    }
  }
  return cachedCatalog;
}

function normalizeText(str = "") {
  return String(str)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isExcludedSubbedOrNonArabicDub(item) {
  const blob = normalizeText(
    `${item?.name || ""} ${item?.pref || ""} ${item?.tags || ""} ${item?.planet_name || ""}`
  );
  return (
    blob.includes("مترجم") ||
    blob.includes("انكليزي") ||
    blob.includes("انجليزي") ||
    blob.includes("english") ||
    blob.includes("ياباني") ||
    blob.includes("japanese")
  );
}

function scoreArabicDubMatch(item, queryTitles = []) {
  let score = 0;
  const normName = normalizeText(item?.name || "");
  const normPref = normalizeText(item?.pref || "");
  const normTags = normalizeText(item?.tags || "");
  const combined = `${normName} ${normPref} ${normTags}`;

  let titleMatched = false;
  for (const rawTitle of queryTitles) {
    const q = normalizeText(rawTitle);
    if (!q) continue;
    if (normName === q) {
      score += 120;
      titleMatched = true;
    } else if (normName.includes(q)) {
      score += 75;
      titleMatched = true;
    } else {
      const tokens = q.split(" ").filter((t) => t.length > 1);
      const hits = tokens.filter((t) => combined.includes(t)).length;
      if (hits > 0) {
        score += hits * 18;
        if (hits >= Math.ceil(tokens.length / 2)) titleMatched = true;
      }
    }
  }

  if (!titleMatched) return 0;

  if (combined.includes("عربي") || combined.includes("مدبلج")) score += 20;
  if (normName.includes("مدبلج") || normPref.includes("مدبلج")) score += 15;

  return score;
}

async function resolveTmdbMeta(tmdbId, mediaType) {
  if (!tmdbId || isNaN(Number(tmdbId))) {
    return { titles: [String(tmdbId || "")], year: null };
  }
  const type = mediaType === "movie" ? "movie" : "tv";
  const apiKey =
    (typeof process !== "undefined" && process.env?.TMDB_API_KEY) ||
    "439c478a771f35c05022f9feabcca01c";

  try {
    const [arRes, enRes] = await Promise.all([
      fetchWithTimeout(
        `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}&language=ar-SA`,
        {},
        4000
      ),
      fetchWithTimeout(
        `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}&language=en-US`,
        {},
        4000
      ),
    ]);
    const arData = arRes.ok ? await arRes.json() : {};
    const enData = enRes.ok ? await enRes.json() : {};
    const titles = [
      arData.title,
      arData.name,
      enData.title,
      enData.original_title,
      enData.name,
      enData.original_name,
    ].filter(Boolean);
    const dateStr =
      arData.release_date ||
      arData.first_air_date ||
      enData.release_date ||
      enData.first_air_date ||
      "";
    const year = dateStr ? Number(dateStr.slice(0, 4)) : null;
    return { titles: [...new Set(titles)], year };
  } catch {
    return { titles: [], year: null };
  }
}

async function probeStreamUrl(url) {
  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": DEFAULT_HEADERS["User-Agent"],
          "Referer": "https://cartoony.net/",
          "Origin": "https://cartoony.net",
          "Range": "bytes=0-128",
        },
      },
      3000
    );
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

async function buildEpisodeStreams(baseUrl, show, episodeDetail) {
  const streams = [];
  const seenUrls = new Set();
  const epNum = episodeDetail?.number ?? 1;
  const prefLabel = episodeDetail?.pref ? ` - ${episodeDetail.pref}` : "";
  const baseTitle = `${show.name} (Ep ${epNum}${prefLabel})`;

  const legacyEp = await fetchJsonDecrypted(
    `${baseUrl}/api/episode?episodeId=${episodeDetail.id}`
  );
  const directUrl = legacyEp?.streamUrl;
  if (
    typeof directUrl === "string" &&
    directUrl.startsWith("http") &&
    !directUrl.includes("410 Gone")
  ) {
    seenUrls.add(directUrl);
    streams.push({
      name: "Cartoony Dub",
      title: `${baseTitle} [Direct]`,
      url: directUrl,
      quality: "HD",
      headers: {
        "Referer": `${baseUrl}/`,
        "Origin": baseUrl,
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
      },
    });
  }

  const ids = [
    episodeDetail?.video_id,
    episodeDetail?.v5_id,
    episodeDetail?.id,
  ].filter(Boolean);

  const candidates = [];
  for (const id of ids) {
    candidates.push(
      `${PEGASUS_ORIGIN}/${id}/playlist.m3u8`,
      `${VOD_ORIGIN}/${id}/playlist.m3u8`,
      `${VOD_ORIGIN}/${id}/play_video/index.m3u8`
    );
  }

  const uniqueCandidates = candidates.filter((u) => !seenUrls.has(u));
  const checks = await Promise.all(
    uniqueCandidates.map(async (u) => ({ url: u, ok: await probeStreamUrl(u) }))
  );

  for (const c of checks) {
    if (c.ok && !seenUrls.has(c.url)) {
      seenUrls.add(c.url);
      streams.push({
        name: "Cartoony Dub",
        title: `${baseTitle} [HLS]`,
        url: c.url,
        quality: "Auto",
        headers: {
          "Referer": "https://cartoony.net/",
          "Origin": "https://cartoony.net",
          "User-Agent": DEFAULT_HEADERS["User-Agent"],
        },
      });
    }
  }

  return streams;
}

async function getStreams(tmdbId, mediaType = "tv", season = 1, episode = 1) {
  const meta = await resolveTmdbMeta(tmdbId, mediaType);
  const queryTitles = meta.titles.length ? meta.titles : [String(tmdbId || "")];
  if (!queryTitles.length || !queryTitles[0]) return [];

  const { base: activeBase, shows } = await getCatalog();
  if (!shows.length) return [];

  const filteredShows = shows
    .filter((s) => !isExcludedSubbedOrNonArabicDub(s))
    .map((s) => ({
      show: s,
      score: scoreArabicDubMatch(s, queryTitles),
    }))
    .filter((entry) => entry.score >= 30)
    .sort((a, b) => b.score - a.score);

  const topCandidates = filteredShows.slice(0, 2);
  const allStreams = [];

  for (const { show } of topCandidates) {
    const episodes = await fetchJsonDecrypted(
      `${activeBase}/api/sp/episodes?id=${show.id}`
    );
    if (!Array.isArray(episodes) || !episodes.length) continue;

    const targetEpNumber = mediaType === "movie" ? 1 : Number(episode || 1);
    const matchedEp =
      episodes.find((ep) => Number(ep.number) === targetEpNumber) || episodes[0];

    if (!matchedEp?.id) continue;

    const detail =
      (await fetchJsonDecrypted(
        `${activeBase}/api/sp/episode?episodeId=${matchedEp.id}`
      )) || matchedEp;

    if (isExcludedSubbedOrNonArabicDub(detail)) continue;

    const epStreams = await buildEpisodeStreams(activeBase, show, detail);
    allStreams.push(...epStreams);
  }

  return allStreams;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
export { getStreams };
