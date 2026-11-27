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

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256Bytes(msg) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLenHi = Math.floor((msg.length * 8) / 0x100000000) >>> 0;
  const bitLenLo = (msg.length * 8) >>> 0;
  const paddedLen = (((msg.length + 9 + 63) / 64) | 0) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  const W = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10)) >>> 0;
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i], false);
  return out;
}

function hmacSha256Pure(keyBytes, dataBytes) {
  let key = keyBytes;
  if (key.length > 64) key = sha256Bytes(key);
  const padKey = new Uint8Array(64);
  padKey.set(key);

  const oKeyPad = new Uint8Array(64);
  const iKeyPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    oKeyPad[i] = padKey[i] ^ 0x5c;
    iKeyPad[i] = padKey[i] ^ 0x36;
  }

  const inner = new Uint8Array(64 + dataBytes.length);
  inner.set(iKeyPad);
  inner.set(dataBytes, 64);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(64 + 32);
  outer.set(oKeyPad);
  outer.set(innerHash, 64);
  return sha256Bytes(outer);
}

function gfMul128(xBytes, yBytes) {
  const z = new Uint8Array(16);
  const v = new Uint8Array(yBytes);

  for (let i = 0; i < 16; i++) {
    const xb = xBytes[i];
    for (let j = 7; j >= 0; j--) {
      if ((xb >>> j) & 1) {
        for (let k = 0; k < 16; k++) z[k] ^= v[k];
      }
      const lsb = v[15] & 1;
      for (let k = 15; k > 0; k--) {
        v[k] = ((v[k] >>> 1) | ((v[k - 1] & 1) << 7)) & 0xff;
      }
      v[0] = (v[0] >>> 1) & 0xff;
      if (lsb) {
        v[0] ^= 0xe1;
      }
    }
  }
  return z;
}

function ghash(hBytes, ctBytes) {
  let y = new Uint8Array(16);
  const fullBlocks = Math.floor(ctBytes.length / 16);

  for (let i = 0; i < fullBlocks; i++) {
    const blk = new Uint8Array(16);
    for (let j = 0; j < 16; j++) blk[j] = y[j] ^ ctBytes[i * 16 + j];
    y = gfMul128(blk, hBytes);
  }

  const rem = ctBytes.length % 16;
  if (rem > 0) {
    const blk = new Uint8Array(16);
    for (let j = 0; j < rem; j++) blk[j] = y[j] ^ ctBytes[fullBlocks * 16 + j];
    for (let j = rem; j < 16; j++) blk[j] = y[j];
    y = gfMul128(blk, hBytes);
  }

  const lenBlock = new Uint8Array(16);
  const lv = new DataView(lenBlock.buffer);
  const bitLen = ctBytes.length * 8;
  lv.setUint32(8, Math.floor(bitLen / 0x100000000) >>> 0, false);
  lv.setUint32(12, bitLen >>> 0, false);

  const lastBlk = new Uint8Array(16);
  for (let j = 0; j < 16; j++) lastBlk[j] = y[j] ^ lenBlock[j];
  return gfMul128(lastBlk, hBytes);
}

const AES_SBOX = new Uint8Array([
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
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
]);

const AES_RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);

function aesXtime(a) {
  return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
}

function aesMul(a, b) {
  let res = 0;
  let x = a & 0xff;
  let y = b & 0xff;
  while (y > 0) {
    if (y & 1) res ^= x;
    x = aesXtime(x);
    y >>>= 1;
  }
  return res & 0xff;
}

function aes256KeySchedule(keyBytes) {
  const w = new Uint32Array(60);
  const dv = new DataView(keyBytes.buffer, keyBytes.byteOffset, 32);
  for (let i = 0; i < 8; i++) {
    w[i] = dv.getUint32(i * 4, false);
  }

  for (let i = 8; i < 60; i++) {
    let temp = w[i - 1];
    if (i % 8 === 0) {
      const rot = (((temp << 8) | (temp >>> 24)) >>> 0);
      const b0 = AES_SBOX[(rot >>> 24) & 0xff] ^ AES_RCON[i / 8 - 1];
      const b1 = AES_SBOX[(rot >>> 16) & 0xff];
      const b2 = AES_SBOX[(rot >>> 8) & 0xff];
      const b3 = AES_SBOX[rot & 0xff];
      temp = (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0);
    } else if (i % 8 === 4) {
      const b0 = AES_SBOX[(temp >>> 24) & 0xff];
      const b1 = AES_SBOX[(temp >>> 16) & 0xff];
      const b2 = AES_SBOX[(temp >>> 8) & 0xff];
      const b3 = AES_SBOX[temp & 0xff];
      temp = (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0);
    }
    w[i] = (w[i - 8] ^ temp) >>> 0;
  }
  return w;
}

function aes256EncryptBlock(keyBytes, blockBytes) {
  const w = aes256KeySchedule(keyBytes);
  const state = new Uint8Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      state[row * 4 + col] = blockBytes[row + 4 * col];
    }
  }

  const addRoundKey = (round) => {
    for (let col = 0; col < 4; col++) {
      const word = w[round * 4 + col];
      state[0 * 4 + col] ^= (word >>> 24) & 0xff;
      state[1 * 4 + col] ^= (word >>> 16) & 0xff;
      state[2 * 4 + col] ^= (word >>> 8) & 0xff;
      state[3 * 4 + col] ^= word & 0xff;
    }
  };

  addRoundKey(0);

  for (let round = 1; round < 14; round++) {
    for (let i = 0; i < 16; i++) {
      state[i] = AES_SBOX[state[i]];
    }

    const r1 = [state[5], state[6], state[7], state[4]];
    state[4] = r1[0]; state[5] = r1[1]; state[6] = r1[2]; state[7] = r1[3];

    const r2 = [state[10], state[11], state[8], state[9]];
    state[8] = r2[0]; state[9] = r2[1]; state[10] = r2[2]; state[11] = r2[3];

    const r3 = [state[15], state[12], state[13], state[14]];
    state[12] = r3[0]; state[13] = r3[1]; state[14] = r3[2]; state[15] = r3[3];

    for (let col = 0; col < 4; col++) {
      const s0 = state[0 * 4 + col];
      const s1 = state[1 * 4 + col];
      const s2 = state[2 * 4 + col];
      const s3 = state[3 * 4 + col];

      state[0 * 4 + col] = aesMul(0x02, s0) ^ aesMul(0x03, s1) ^ s2 ^ s3;
      state[1 * 4 + col] = s0 ^ aesMul(0x02, s1) ^ aesMul(0x03, s2) ^ s3;
      state[2 * 4 + col] = s0 ^ s1 ^ aesMul(0x02, s2) ^ aesMul(0x03, s3);
      state[3 * 4 + col] = aesMul(0x03, s0) ^ s1 ^ s2 ^ aesMul(0x02, s3);
    }

    addRoundKey(round);
  }

  for (let i = 0; i < 16; i++) {
    state[i] = AES_SBOX[state[i]];
  }
  const r1 = [state[5], state[6], state[7], state[4]];
  state[4] = r1[0]; state[5] = r1[1]; state[6] = r1[2]; state[7] = r1[3];

  const r2 = [state[10], state[11], state[8], state[9]];
  state[8] = r2[0]; state[9] = r2[1]; state[10] = r2[2]; state[11] = r2[3];

  const r3 = [state[15], state[12], state[13], state[14]];
  state[12] = r3[0]; state[13] = r3[1]; state[14] = r3[2]; state[15] = r3[3];

  addRoundKey(14);

  const out = new Uint8Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[row + 4 * col] = state[row * 4 + col];
    }
  }
  return out;
}

function aes256GcmDecryptPure(keyBytes, ivBytes, ctBytes, tagBytes) {
  const h = aes256EncryptBlock(keyBytes, new Uint8Array(16));
  const j0 = new Uint8Array(16);
  if (ivBytes.length === 12) {
    j0.set(ivBytes);
    j0[15] = 1;
  } else {
    j0.set(ghash(h, ivBytes));
  }

  const computedTag = ghash(h, ctBytes);
  const tagMask = aes256EncryptBlock(keyBytes, j0);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= (computedTag[i] ^ tagMask[i]) ^ tagBytes[i];
  if (diff !== 0) {
    throw new Error("GCM auth tag mismatch");
  }

  const plain = new Uint8Array(ctBytes.length);
  const ctr = new Uint8Array(j0);
  const inc32 = () => {
    for (let i = 15; i >= 12; i--) {
      if (ctr[i] === 0xff) ctr[i] = 0;
      else { ctr[i]++; break; }
    }
  };

  for (let off = 0; off < ctBytes.length; off += 16) {
    inc32();
    const ks = aes256EncryptBlock(keyBytes, ctr);
    const n = Math.min(16, ctBytes.length - off);
    for (let i = 0; i < n; i++) plain[off + i] = ctBytes[off + i] ^ ks[i];
  }
  return plain;
}

async function decryptPayload(encObj, nVal) {
  if (!encObj || encObj.v !== 1 || !encObj.i || !encObj.d || !nVal) {
    return encObj;
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
  const nBytes = utf8ToBytes(String(nVal));

  const subtle =
    (typeof crypto !== "undefined" && crypto.subtle) ||
    (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle);

  if (subtle) {
    try {
      const hKey = await subtle.importKey(
        "raw",
        hmacKeyBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const aesKeyRaw = await subtle.sign("HMAC", hKey, nBytes);
      const aesKey = await subtle.importKey("raw", aesKeyRaw, { name: "AES-GCM" }, false, [
        "decrypt",
      ]);
      const combined = new Uint8Array(cipherText.length + tag.length);
      combined.set(cipherText, 0);
      combined.set(tag, cipherText.length);
      const plainBuf = await subtle.decrypt({ name: "AES-GCM", iv }, aesKey, combined);
      return JSON.parse(bytesToUtf8(new Uint8Array(plainBuf)));
    } catch (_) {}
  }

  const aesKeyPure = hmacSha256Pure(hmacKeyBytes, nBytes);
  const plainBytes = aes256GcmDecryptPure(aesKeyPure, iv, cipherText, tag);
  return JSON.parse(bytesToUtf8(plainBytes));
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

  if (!data?.n) {
    throw new Error(data?.detail || "Session missing nonce");
  }

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

function extractTmdbId(raw, meta = {}) {
  const candidates = [
    raw?.tmdbId,
    raw?.tmdb_id,
    meta?.tmdbId,
    meta?.tmdb_id,
    typeof raw?.id === "string" && raw.id.startsWith("tmdb:") ? raw.id.replace(/^tmdb:/i, "") : null,
  ];
  for (const c of candidates) {
    if (c != null && /^\d+$/.test(String(c).trim())) {
      return String(c).trim();
    }
  }
  return null;
}

function parseInvocationParams(arg1, arg2, arg3, arg4, arg5) {
  if (arg1 && typeof arg1 === "object" && !Array.isArray(arg1)) {
    const meta = arg1.meta || arg1.metadata || arg1.userConfig || arg1.context || {};
    const tmdbId = extractTmdbId(arg1, meta);
    const rawId = arg1.id != null ? String(arg1.id) : null;
    const isImdb = rawId ? /^tt\d+/i.test(rawId) : false;

    return {
      anilistId: arg1.anilistId || arg1.anilist_id || meta.anilistId || null,
      malId: arg1.malId || arg1.idMal || meta.malId || meta.idMal || null,
      tmdbId,
      imdbId: arg1.imdbId || arg1.imdb_id || meta.imdbId || (isImdb ? rawId : null),
      id: rawId,
      mediaType: arg1.mediaType || arg1.type || meta.mediaType || null,
      season: Number(arg1.season ?? meta.season ?? 1) || 1,
      episode: Number(arg1.episode ?? arg1.ep ?? meta.episode ?? 1) || 1,
      title:
        arg1.title ||
        arg1.name ||
        arg1.query ||
        arg1.seriesTitle ||
        meta.title ||
        meta.name ||
        "",
      year: arg1.year || arg1.releaseYear || meta.year || null,
    };
  }

  const cfg = arg5 && typeof arg5 === "object" ? arg5 : {};
  const meta = cfg.meta || cfg.metadata || {};
  const rawId = arg1 != null ? String(arg1) : "";
  const isImdb = /^tt\d+/i.test(rawId);
  const tmdbFromPrefix = /^tmdb:(\d+)$/i.exec(rawId)?.[1] || null;
  const tmdbId =
    extractTmdbId(cfg, meta) ||
    tmdbFromPrefix ||
    (!isImdb && /^\d+$/.test(rawId) ? rawId : null);

  return {
    anilistId: cfg.anilistId || meta.anilistId || null,
    malId: cfg.malId || cfg.idMal || meta.malId || null,
    tmdbId,
    imdbId: isImdb ? rawId : cfg.imdbId || meta.imdbId || null,
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
            id: `anichan-${category}-${tier}-${srv.name || streams.length}`,
            name: `AniChan (${category.toUpperCase()})`,
            title: `${srv.label || srv.name || "HLS"} · ${category.toUpperCase()} · ${tier}`,
            url: streamUrl,
            type: srv.type || "hls",
            headers: {
              "User-Agent": UA,
              Referer: `${BASE}/`,
            },
            behaviorHints: {
              notWebReady: false,
              proxyHeaders: {
                request: {
                  "User-Agent": UA,
                  Referer: `${BASE}/`,
                },
              },
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

export { getStreams, aes256GcmDecryptPure, hmacSha256Pure };
export default { id: "anichan", getStreams };
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, aes256GcmDecryptPure, hmacSha256Pure, default: { id: "anichan", getStreams } };
}
