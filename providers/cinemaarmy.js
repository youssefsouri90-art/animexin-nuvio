// cinema.army provider for Nuvio.
// Mirrors the site's own front-end flow (public JS): per-server API call with an
// X-Stream-Token header (HMAC-SHA256 of "<tmdb>:<minute>"), response url is
// either plain or base64+XOR. Pure JS (no crypto.subtle / TextEncoder needed).
// v2: detects real qualities from the HLS master playlist so Nuvio shows them.

const API = "https://cinema.army/api";
const SITE = "https://cinema.army/";
const UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

// Constants copied from the site's public bundle.
const XOR_KEY = "f16a6b92fcd6eed3e9476297f893f2505c32f79bc6efef9b6c95496aa5914548";
const HMAC_KEY = "a2cfc9eaa2a3690b5d4f6b5f958dbdeae52a097283d375bd253ee7c7062524f5";

const MOVIE_SERVERS = [
  { key: "cookiebakers", name: "Server 1", method: "POST" },
  { key: "ngcloud", name: "Server 2", method: "GET" },
  { key: "tcloud", name: "Server 3", method: "GET" },
  { key: "ipcloud", name: "Server 4", method: "GET" },
  { key: "dcloud", name: "Server 5", method: "GET" },
];
const TV_SERVERS = [
  { key: "cookiebakers", name: "Server 1", method: "POST" },
  { key: "tcloud", name: "Server 2", method: "GET" },
  { key: "ipcloud", name: "Server 3", method: "GET" },
  { key: "dcloud", name: "Server 4", method: "GET" },
];

// Quality label used when the real quality can't be detected.
const FALLBACK_QUALITY = "1080p";

// ---------- SHA-256 / HMAC (pure JS) ----------
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function ror(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function sha256(msg) {
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const l = msg.length;
  const p = msg.slice();
  p.push(0x80);
  while (p.length % 64 !== 56) p.push(0);
  const hi = Math.floor(l / 0x20000000);
  const lo = (l << 3) >>> 0;
  p.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  p.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

  const w = new Array(64);
  for (let off = 0; off < p.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3]) | 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
  }
  return out;
}

function strBytes(s) {
  const b = [];
  for (let i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 255); // ASCII only
  return b;
}

function hmacSha256Hex(keyStr, msgStr) {
  let key = strBytes(keyStr);
  if (key.length > 64) key = sha256(key);
  while (key.length < 64) key.push(0);
  const ipad = key.map((x) => x ^ 0x36);
  const opad = key.map((x) => x ^ 0x5c);
  const inner = sha256(ipad.concat(strBytes(msgStr)));
  const mac = sha256(opad.concat(inner));
  return mac.map((x) => (x < 16 ? "0" : "") + x.toString(16)).join("");
}

function streamToken(tmdbId) {
  const minute = Math.floor(Date.now() / 1000 / 60);
  return hmacSha256Hex(HMAC_KEY, tmdbId + ":" + minute);
}

// Same as the site's url decoder: plain http(s) stays, otherwise base64 + XOR.
function decodeUrl(e) {
  if (!e) return "";
  if (e.indexOf("http://") === 0 || e.indexOf("https://") === 0) return e;
  try {
    const t = atob(e);
    let n = "";
    for (let i = 0; i < t.length; i++) {
      n += String.fromCharCode(t.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % 64));
    }
    return n;
  } catch (err) {
    return e;
  }
}

// ---------- HLS quality detection ----------
function heightToQuality(h) {
  if (h >= 2160) return "4K";
  if (h >= 1440) return "1440p";
  if (h >= 1080) return "1080p";
  if (h >= 720) return "720p";
  if (h >= 480) return "480p";
  return "360p";
}

function resolveUrl(base, ref) {
  if (/^https?:\/\//i.test(ref)) return ref;
  const m = base.match(/^(https?:\/\/[^\/]+)(\/[^?#]*)?/i);
  if (!m) return ref;
  const origin = m[1];
  if (ref.charAt(0) === "/") return origin + ref;
  const path = m[2] || "/";
  return origin + path.slice(0, path.lastIndexOf("/") + 1) + ref;
}

// Returns [{ url, height, bandwidth }] sorted best-first,
// or [] if the url is not a master playlist or the fetch fails.
async function parseMaster(url, headers) {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const text = await res.text();
    if (text.indexOf("#EXT-X-STREAM-INF") === -1) return [];
    const lines = text.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      const rm = lines[i].match(/RESOLUTION=(\d+)x(\d+)/i);
      const bm = lines[i].match(/BANDWIDTH=(\d+)/i);
      let next = "";
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] && lines[j].charAt(0) !== "#") {
          next = lines[j].trim();
          break;
        }
      }
      if (!next) continue;
      out.push({
        url: resolveUrl(url, next),
        height: rm ? parseInt(rm[2], 10) : 0,
        bandwidth: bm ? parseInt(bm[1], 10) : 0,
      });
    }
    out.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
    return out;
  } catch (e) {
    return [];
  }
}

// ---------- provider ----------
async function fetchServer(srv, path, token) {
  const res = await fetch(API + "/" + srv.key + path, {
    method: srv.method,
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: SITE,
      Origin: "https://cinema.army",
      "X-Stream-Token": token,
    },
  });
  if (!res.ok) return { srv, err: "http" + res.status };
  let j;
  try {
    j = JSON.parse(await res.text());
  } catch (e) {
    return { srv, err: "badjson" };
  }
  const raw = j && j.stream && j.stream.url;
  if (!raw) return { srv, err: "nourl" };
  const url = decodeUrl(raw);
  if (!/^https?:\/\//i.test(url)) return { srv, err: "baddecode" };
  return { srv, url };
}

function fail(results) {
  const sum = results
    .map((r) => r.srv.key + ":" + (r.err || (r.url ? "ok" : "?")))
    .join(" ");
  return [
    { name: "CinemaArmy v2: " + sum, title: "debug", url: "https://debug.invalid/ca", quality: "debug" },
  ];
}

async function getStreams(tmdbId, mediaType, season, episode) {
  const isTv = mediaType === "tv";
  const id = String(tmdbId);
  const path = isTv
    ? "/tv/" + id + "/" + (Number(season) || 1) + "/" + (Number(episode) || 1)
    : "/movie/" + id;
  const servers = isTv ? TV_SERVERS : MOVIE_SERVERS;
  let token;
  try {
    token = streamToken(id);
  } catch (e) {
    return fail([{ srv: { key: "token" }, err: "error" }]);
  }

  const results = await Promise.all(
    servers.map((srv) =>
      fetchServer(srv, path, token).catch((e) => ({
        srv,
        err: String((e && e.message) || e).slice(0, 25),
      }))
    )
  );

  const good = results.filter((r) => r.url);
  if (!good.length) return fail(results);

  const hdrs = { "User-Agent": UA, Referer: SITE, Origin: "https://cinema.army" };

  // One entry per server, each resolved to its real qualities (kept in server order).
  const perServer = await Promise.all(
    good.map(async (r) => {
      const list = [];
      const variants = await parseMaster(r.url, hdrs);
      if (variants.length) {
        const seen = {};
        variants.forEach((v) => {
          const q = v.height ? heightToQuality(v.height) : FALLBACK_QUALITY;
          if (seen[q]) return; // keep the highest-bandwidth variant per quality
          seen[q] = true;
          list.push({
            name: "CinemaArmy " + q,
            title: r.srv.name + " - " + q,
            url: v.url,
            quality: q,
            headers: hdrs,
            provider: "cinemaarmy",
          });
        });
      } else {
        // Couldn't read a master playlist: return the raw link with a valid quality label.
        list.push({
          name: "CinemaArmy " + FALLBACK_QUALITY,
          title: r.srv.name,
          url: r.url,
          quality: FALLBACK_QUALITY,
          headers: hdrs,
          provider: "cinemaarmy",
        });
      }
      return list;
    })
  );

  const streams = [];
  perServer.forEach((list) => list.forEach((s) => streams.push(s)));
  return streams;
}

module.exports = { getStreams, hmacSha256Hex, sha256, decodeUrl, parseMaster, heightToQuality };
