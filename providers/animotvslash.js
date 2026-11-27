// AnimoTVSlash provider for Nuvio (QuickJS: no DOM, no Node APIs)
const BASE_URL = "https://animotvslash.org";
const VIDNEST_API = "https://promox.vidnest.fun";
const VIDNEST_SECRET = "K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY =
  (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ||
  "4d15cca3b68f75e9a08080dbe6a0568b";

const UA_STR =
  "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const SITE_HEADERS = {
  "User-Agent": UA_STR,
  Referer: BASE_URL + "/",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const VIDNEST_HEADERS = {
  "User-Agent": UA_STR,
  Referer: "https://vidnest.fun/",
  Origin: "https://vidnest.fun",
  Accept: "application/json,text/plain,*/*",
};

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function fallbackBtoa(binStr) {
  if (typeof btoa === "function") return btoa(binStr);
  let out = "";
  for (let i = 0; i < binStr.length; i += 3) {
    const c1 = binStr.charCodeAt(i) & 0xff;
    const c2 = i + 1 < binStr.length ? binStr.charCodeAt(i + 1) & 0xff : NaN;
    const c3 = i + 2 < binStr.length ? binStr.charCodeAt(i + 2) & 0xff : NaN;

    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4);
    const e3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6);
    const e4 = isNaN(c3) ? 64 : c3 & 63;

    out +=
      B64_CHARS.charAt(e1) +
      B64_CHARS.charAt(e2) +
      (e3 === 64 ? "=" : B64_CHARS.charAt(e3)) +
      (e4 === 64 ? "=" : B64_CHARS.charAt(e4));
  }
  return out;
}

function fallbackAtob(b64Str) {
  if (typeof atob === "function") {
    try {
      return atob(b64Str);
    } catch (_) {}
  }
  const clean = String(b64Str || "").replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = B64_CHARS.indexOf(clean.charAt(i));
    const e2 = B64_CHARS.indexOf(clean.charAt(i + 1));
    const c3 = clean.charAt(i + 2);
    const c4 = clean.charAt(i + 3);
    const e3 = c3 === "=" ? 64 : B64_CHARS.indexOf(c3);
    const e4 = c4 === "=" ? 64 : B64_CHARS.indexOf(c4);

    if (e1 < 0 || e2 < 0) continue;
    out += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 !== 64 && e3 >= 0) {
      out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    }
    if (e4 !== 64 && e4 >= 0) {
      out += String.fromCharCode(((e3 & 3) << 6) | e4);
    }
  }
  return out;
}

function encodeUtf8(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(String(str));
  }
  const s = String(str);
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(++i);
      const cp = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff));
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function decodeUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch (_) {}
  }
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0 && i < bytes.length) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if ((b0 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
      );
    } else if ((b0 & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      const u = cp - 0x10000;
      out += String.fromCharCode(0xd800 | (u >> 10), 0xdc00 | (u & 0x3ff));
    } else {
      out += String.fromCharCode(b0);
    }
  }
  return out;
}

function decodeBase64Html(b64Str) {
  const raw = fallbackAtob(String(b64Str || "").replace(/[^A-Za-z0-9+/=]/g, ""));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return decodeUtf8(arr);
}

function makeVidnestNonce() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return fallbackBtoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s + "===".slice((s.length + 3) % 4);
  const bin = fallbackAtob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- Pure JS SHA-256 ---
function sha256Bytes(msgBytes) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = msgBytes.length * 8;
  const paddedLen = Math.ceil((msgBytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(msgBytes);
  buf[msgBytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((val, idx) => outView.setUint32(idx * 4, val, false));
  return out;
}

// --- Pure JS GF(2^128) & AES-256-GCM ---
function gfMul(xHigh, xLow, yHigh, yLow) {
  let zHigh = 0, zLow = 0;
  let vHigh = xHigh, vLow = xLow;
  for (let i = 0; i < 128; i++) {
    const bit = (i < 64 ? (yHigh >>> (63 - i)) : (yLow >>> (95 - i))) & 1;
    if (bit) {
      zHigh ^= vHigh;
      zLow ^= vLow;
    }
    const lsb = vLow & 1;
    vLow = ((vLow >>> 1) | ((vHigh & 1) << 31)) >>> 0;
    vHigh = (vHigh >>> 1) >>> 0;
    if (lsb) {
      vHigh ^= 0xe1000000;
    }
  }
  return [zHigh >>> 0, zLow >>> 0];
}

function ghash(hBytes, aadBytes, ctBytes) {
  const hv = new DataView(hBytes.buffer, hBytes.byteOffset, 16);
  const hHigh = hv.getUint32(0, false);
  const hLow = hv.getUint32(4, false);
  let yHigh = 0, yLow = 0;

  const feedBlock = (block16) => {
    const bv = new DataView(block16.buffer, block16.byteOffset, 16);
    yHigh = (yHigh ^ bv.getUint32(0, false)) >>> 0;
    yLow = (yLow ^ bv.getUint32(4, false)) >>> 0;
    const m1 = gfMul(yHigh, yLow, hHigh, hLow);
    yHigh = m1[0]; yLow = m1[1];
  };

  const feedStream = (arr) => {
    for (let i = 0; i < arr.length; i += 16) {
      const blk = new Uint8Array(16);
      blk.set(arr.subarray(i, Math.min(i + 16, arr.length)));
      feedBlock(blk);
    }
  };

  feedStream(aadBytes);
  feedStream(ctBytes);

  const lenBlk = new Uint8Array(16);
  const lv = new DataView(lenBlk.buffer);
  lv.setUint32(4, aadBytes.length * 8, false);
  lv.setUint32(12, ctBytes.length * 8, false);
  feedBlock(lenBlk);

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, yHigh, false);
  ov.setUint32(4, yLow, false);
  return out;
}

function aes256EncryptBlock(key32, block16) {
  const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
  const SBOX = new Uint8Array(256);
  const xtime = (x) => ((x << 1) ^ ((x & 0x80) ? 0x1b : 0)) & 0xff;
  let p = 1, q = 1;
  for (let i = 0; i < 256; i++) {
    let s = q ^ ((q << 1) & 0xff) ^ ((q << 2) & 0xff) ^ ((q << 3) & 0xff) ^ ((q << 4) & 0xff);
    s = ((s >>> 8) ^ (s & 0xff) ^ 0x63) & 0xff;
    SBOX[p] = s;
    p = (p ^ xtime(p)) & 0xff;
    q ^= xtime(q); q ^= xtime(q); q ^= xtime(q); q &= 0xff;
  }
  SBOX[0] = 0x63;

  const w = new Uint32Array(60);
  const kv = new DataView(key32.buffer, key32.byteOffset, 32);
  for (let i = 0; i < 8; i++) w[i] = kv.getUint32(i * 4, false);

  const subWord = (word) =>
    ((SBOX[(word >>> 24) & 0xff] << 24) |
     (SBOX[(word >>> 16) & 0xff] << 16) |
     (SBOX[(word >>> 8) & 0xff] << 8) |
     SBOX[word & 0xff]) >>> 0;
  const rotWord = (word) => (((word << 8) | (word >>> 24))) >>> 0;

  for (let i = 8; i < 60; i++) {
    let temp = w[i - 1];
    if (i % 8 === 0) temp = (subWord(rotWord(temp)) ^ (RCON[i / 8] << 24)) >>> 0;
    else if (i % 8 === 4) temp = subWord(temp);
    w[i] = (w[i - 8] ^ temp) >>> 0;
  }

  let s0 = new DataView(block16.buffer, block16.byteOffset, 16).getUint32(0, false);
  let s1 = new DataView(block16.buffer, block16.byteOffset, 16).getUint32(4, false);
  let s2 = new DataView(block16.buffer, block16.byteOffset, 16).getUint32(8, false);
  let s3 = new DataView(block16.buffer, block16.byteOffset, 16).getUint32(12, false);

  const addRoundKey = (rk) => {
    s0 ^= w[rk]; s1 ^= w[rk + 1]; s2 ^= w[rk + 2]; s3 ^= w[rk + 3];
  };

  const subBytesAndShiftRows = () => {
    const b = new Uint8Array(16);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, s0, false); dv.setUint32(4, s1, false); dv.setUint32(8, s2, false); dv.setUint32(12, s3, false);
    const n = new Uint8Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        n[r + 4 * c] = SBOX[b[r + 4 * ((c + r) % 4)]];
      }
    }
    const nv = new DataView(n.buffer);
    s0 = nv.getUint32(0, false); s1 = nv.getUint32(4, false); s2 = nv.getUint32(8, false); s3 = nv.getUint32(12, false);
  };

  const mixColumns = () => {
    const b = new Uint8Array(16);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, s0, false); dv.setUint32(4, s1, false); dv.setUint32(8, s2, false); dv.setUint32(12, s3, false);
    const n = new Uint8Array(16);
    for (let c = 0; c < 4; c++) {
      const i = c * 4;
      const a0 = b[i], a1 = b[i + 1], a2 = b[i + 2], a3 = b[i + 3];
      n[i] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
      n[i + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
      n[i + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
      n[i + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
    }
    const nv = new DataView(n.buffer);
    s0 = nv.getUint32(0, false); s1 = nv.getUint32(4, false); s2 = nv.getUint32(8, false); s3 = nv.getUint32(12, false);
  };

  addRoundKey(0);
  for (let round = 1; round < 14; round++) {
    subBytesAndShiftRows();
    mixColumns();
    addRoundKey(round * 4);
  }
  subBytesAndShiftRows();
  addRoundKey(56);

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, s0, false); ov.setUint32(4, s1, false); ov.setUint32(8, s2, false); ov.setUint32(12, s3, false);
  return out;
}

function inc32(counter16) {
  const out = new Uint8Array(counter16);
  const dv = new DataView(out.buffer);
  dv.setUint32(12, (dv.getUint32(12, false) + 1) >>> 0, false);
  return out;
}

function decryptVidnestPayload(dB64Url, nVal) {
  const raw = b64UrlToBytes(dB64Url);
  if (raw.length < 29) throw new Error("Payload too short");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);

  const key = sha256Bytes(encodeUtf8(`${nVal}|${VIDNEST_SECRET}`));
  const H = aes256EncryptBlock(key, new Uint8Array(16));

  const j0 = new Uint8Array(16);
  j0.set(iv, 0);
  j0[15] = 1;

  const expectedTag = aes256EncryptBlock(key, j0);
  const calcGhash = ghash(H, new Uint8Array(0), ct);
  let diff = 0;
  for (let i = 0; i < 16; i++) {
    expectedTag[i] ^= calcGhash[i];
    diff |= expectedTag[i] ^ tag[i];
  }
  if (diff !== 0) throw new Error("GCM tag mismatch");

  const plain = new Uint8Array(ct.length);
  let ctr = inc32(j0);
  for (let i = 0; i < ct.length; i += 16) {
    const ks = aes256EncryptBlock(key, ctr);
    const end = Math.min(i + 16, ct.length);
    for (let j = i; j < end; j++) plain[j] = ct[j] ^ ks[j - i];
    ctr = inc32(ctr);
  }

  return JSON.parse(decodeUtf8(plain));
}

async function safeText(url, headers) {
  try {
    const res = await fetch(url, { headers: headers || SITE_HEADERS });
    if (!res || !res.ok) return "";
    return await res.text();
  } catch (_) {
    return "";
  }
}

async function safeJson(url, headers) {
  try {
    const res = await fetch(url, { headers: headers || SITE_HEADERS });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function getTmdbTitles(tmdbId, mediaType) {
  const kind = String(mediaType || "").toLowerCase() === "movie" ? "movie" : "tv";
  const url = `${TMDB_API}/${kind}/${encodeURIComponent(String(tmdbId))}?api_key=${encodeURIComponent(TMDB_KEY)}&append_to_response=alternative_titles,external_ids`;
  const data = await safeJson(url, { "User-Agent": UA_STR, Accept: "application/json" });
  if (!data) return [];

  const titles = [];
  const pushTitle = (t) => {
    const clean = String(t || "").trim();
    if (clean && titles.indexOf(clean) === -1) titles.push(clean);
  };

  pushTitle(data.title);
  pushTitle(data.name);
  pushTitle(data.original_title);
  pushTitle(data.original_name);

  const altList =
    (data.alternative_titles && (data.alternative_titles.titles || data.alternative_titles.results)) ||
    [];
  for (let i = 0; i < altList.length; i++) {
    pushTitle(altList[i] && altList[i].title);
  }
  return titles;
}

function normSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function scoreAnimeCandidate(url, text, titles, seasonNum) {
  const u = String(url || "").toLowerCase();
  const t = String(text || "").toLowerCase();
  let score = 0;

  if (/\btv\b/.test(t)) score += 25;
  if (/\b(movie|ova|special|chronicle|recap|part-i|part-ii)\b/.test(u + " " + t)) score -= 25;

  const sNum = Number(seasonNum) || 1;
  const hasSeasonInUrl = /season[-_ ]?(\d+)/i.test(u);
  const seasonMatch = /season[-_ ]?(\d+)/i.exec(u + " " + t);
  const foundSeason = seasonMatch ? Number(seasonMatch[1]) : 1;

  if (sNum > 1) {
    if (foundSeason === sNum) score += 35;
    else if (!hasSeasonInUrl) score -= 10;
    else score -= 30;
  } else {
    if (!hasSeasonInUrl || foundSeason === 1) score += 20;
    else score -= 20;
  }

  for (let i = 0; i < titles.length; i++) {
    const sl = normSlug(titles[i]);
    if (!sl) continue;
    if (u.indexOf("/anime/" + sl + "/") !== -1) score += 40 - i * 3;
    else if (u.indexOf(sl) !== -1) score += 15 - i * 2;
  }

  return score;
}

async function findAnimePage(titles, seasonNum) {
  const sNum = Number(seasonNum) || 1;
  const candidates = [];
  const seen = {};

  for (let i = 0; i < titles.length; i++) {
    const q = titles[i];
    const slug = normSlug(q);
    if (slug) {
      const directList = [
        sNum > 1 ? `${BASE_URL}/anime/${slug}-season-${sNum}/` : `${BASE_URL}/anime/${slug}/`,
        `${BASE_URL}/anime/${slug}/`,
      ];
      for (let d = 0; d < directList.length; d++) {
        const du = directList[d];
        if (!seen[du]) {
          seen[du] = true;
          candidates.push({ url: du, text: q, score: scoreAnimeCandidate(du, q, titles, sNum) + 10 });
        }
      }
    }

    const sHtml = await safeText(`${BASE_URL}/?s=${encodeURIComponent(q)}`, SITE_HEADERS);
    if (!sHtml) continue;
    const linkRe =
      /<a[^>]+href=["'](https?:\/\/animotvslash\.org\/anime\/[^"'?#]+\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRe.exec(sHtml)) !== null) {
      const cu = m[1].endsWith("/") ? m[1] : m[1] + "/";
      if (/\/episode-/i.test(cu)) continue;
      const cleanTxt = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!seen[cu]) {
        seen[cu] = true;
        candidates.push({
          url: cu,
          text: cleanTxt,
          score: scoreAnimeCandidate(cu, cleanTxt, titles, sNum),
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  for (let i = 0; i < Math.min(candidates.length, 6); i++) {
    const pageHtml = await safeText(candidates[i].url, SITE_HEADERS);
    if (pageHtml && /episode|sub|dub|\/anime\/\d+/i.test(pageHtml)) {
      return { url: candidates[i].url, html: pageHtml };
    }
  }
  return null;
}

function findEpisodeUrl(animeUrl, animeHtml, episodeNum) {
  const ep = Number(episodeNum) || 1;
  const linkRe = /href=["'](https?:\/\/animotvslash\.org\/[^"'?#]+episode[^"'?#]*)["']/gi;
  let m;
  while ((m = linkRe.exec(animeHtml)) !== null) {
    const u = m[1];
    if (/\.(css|js|png|jpg|jpeg|webp|svg|woff2?)(\?|$)/i.test(u)) continue;
    const epMatch = /episode-(\d+(?:\.\d+)?)/i.exec(u);
    if (epMatch && Number(epMatch[1]) === ep) {
      return u.endsWith("/") ? u : u + "/";
    }
  }
  const baseNoSlash = animeUrl.replace(/\/+$/, "");
  return `${baseNoSlash}-episode-${ep}/`;
}

function parseEpisodeEmbedMeta(epHtml, fallbackEpNum) {
  let anilistId = null;
  let episodeNum = Number(fallbackEpNum) || 1;
  let subOrDub = "sub";

  const optionRe =
    /<option[^>]*value=["']([A-Za-z0-9+/=]{20,})["'][^>]*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = optionRe.exec(epHtml)) !== null) {
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const decoded = decodeBase64Html(m[1]);
    const srcMatch = /src=["']([^"'>]+)["']/i.exec(decoded);
    const src = srcMatch ? srcMatch[1] : decoded;

    const pathMatch = /\/(?:stream\/ani|anime)\/(\d+)\/(\d+)\/(sub|dub)/i.exec(src);
    if (pathMatch) {
      anilistId = pathMatch[1];
      episodeNum = Number(pathMatch[2]) || episodeNum;
      subOrDub = pathMatch[3].toLowerCase();
      if (/vidnest/i.test(src) || /softsub/i.test(label)) break;
    }
  }

  if (!anilistId) {
    const anyMatch = /\/(?:stream\/ani|anime)\/(\d+)\/(\d+)\/(sub|dub)/i.exec(epHtml);
    if (anyMatch) {
      anilistId = anyMatch[1];
      episodeNum = Number(anyMatch[2]) || episodeNum;
      subOrDub = anyMatch[3].toLowerCase();
    }
  }

  return { anilistId, episodeNum, subOrDub };
}

async function fetchVidnestStream(anilistId, episodeNum, subOrDub) {
  const mode = subOrDub === "dub" ? "dub" : "sub";
  const endpoints = [
    `${VIDNEST_API}/hianime/anime/${anilistId}/${episodeNum}/${mode}/hd-2`,
    `${VIDNEST_API}/animehub/${anilistId}/${episodeNum}/${mode}`,
    `${VIDNEST_API}/aniwave_hls/${anilistId}/${episodeNum}/${mode}`,
  ];

  for (let i = 0; i < endpoints.length; i++) {
    try {
      const url = `${endpoints[i]}?_n=${encodeURIComponent(makeVidnestNonce())}`;
      const res = await fetch(url, { headers: VIDNEST_HEADERS });
      if (!res || !res.ok) continue;

      const json = await res.json();
      const data =
        json && json.v === 2 && json.d
          ? decryptVidnestPayload(json.d, json.n)
          : json;

      const srcList = (data && (data.sources || data.multiSrc)) || [];
      const firstSrc =
        srcList.find((x) => x && (x.file || x.url)) || srcList[0];
      const streamUrl = firstSrc && (firstSrc.file || firstSrc.url);
      if (!streamUrl) continue;

      const rawTracks = (data && (data.tracks || data.subtitles)) || [];
      const subtitles = rawTracks
        .filter((t) => t && t.kind !== "thumbnails")
        .map((t, idx) => {
          const fileUrl = String((t && (t.file || t.url)) || "").trim();
          if (!fileUrl || /thumbnails\.vtt/i.test(fileUrl)) return null;

          const rawLabel = String(
            (t && (t.label || t.lang || t.language)) || `Track ${idx + 1}`
          ).trim();
          const isArabic =
            /arabic|\bara\b|\bar\b/i.test(rawLabel) || /\/ara[-_]/i.test(fileUrl);
          const langName = isArabic ? "Arabic" : rawLabel;

          return {
            id: `sub-${idx + 1}`,
            url: fileUrl,
            file: fileUrl,
            lang: langName,
            language: langName,
            label: langName,
            format: /\.srt(\?|$)/i.test(fileUrl) ? "srt" : "vtt",
            isArabic,
            default: isArabic,
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b.isArabic ? 1 : 0) - (a.isArabic ? 1 : 0));

      return {
        streamUrl,
        headers:
          firstSrc && firstSrc.referer
            ? { Referer: firstSrc.referer, "User-Agent": UA_STR }
            : VIDNEST_HEADERS,
        subtitles,
      };
    } catch (_) {}
  }
  return null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (!tmdbId) return [];
    const epNum = Number(episode) || 1;
    const seasonNum = Number(season) || 1;
    const titles = await getTmdbTitles(tmdbId, mediaType);
    if (!titles.length) return [];

    const animePage = await findAnimePage(titles, seasonNum);
    if (!animePage) return [];

    const epUrl = findEpisodeUrl(animePage.url, animePage.html, epNum);
    const epHtml = await safeText(epUrl, {
      "User-Agent": UA_STR,
      Referer: animePage.url,
    });
    if (!epHtml) return [];

    const meta = parseEpisodeEmbedMeta(epHtml, epNum);
    if (!meta.anilistId) return [];

    const result = await fetchVidnestStream(
      meta.anilistId,
      meta.episodeNum,
      meta.subOrDub
    );
    if (!result || !result.streamUrl) return [];

    return [
      {
        id: `animotvslash-${meta.anilistId}-${meta.episodeNum}-${meta.subOrDub}`,
        name: "AnimoTVSlash",
        title: `AnimoTVSlash (${meta.subOrDub.toUpperCase()})`,
        url: result.streamUrl,
        quality: "auto",
        headers: result.headers,
        provider: "animotvslash",
        subtitles: result.subtitles,
      },
    ];
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
