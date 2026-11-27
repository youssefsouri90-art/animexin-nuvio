// Animotvslash (animotvslash.org) SoftSub provider for Nuvio (QuickJS: pure JS AES-256-CBC).
// Flow: TMDB/Kitsu -> search animotvslash.org/anime/?s=... -> episode page -> SoftSub mirrors
//       -> megaplay.buzz /stream/getSources + AES-256-CBC decrypt (or direct m3u8)
//       -> expand HLS -> Arabic subtitles only

const BASE = "https://animotvslash.org";
const TMDB_API_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

const SOURCE_ENC_KEY = "i?LMTAx0Q6,:}50U";
const SOURCE_ENC_IV = "W0;27ToaUpl_P%'c";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
};

const PAGE_HEADERS = Object.assign({}, UA, {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
  Referer: BASE + "/",
});

const MAX_SOFTSUB_SCAN = 8;
const MAX_STREAMS = 12;
const DIAG = [];

function originOf(u) {
  var m = /^(https?:\/\/[^\/?#]+)/i.exec(String(u || ""));
  return m ? m[1] : BASE;
}

function absUrl(base, rel) {
  if (!rel) return "";
  var s = String(rel).trim();
  if (/^https?:/i.test(s)) return s;
  if (/^\/\//.test(s)) return "https:" + s;
  if (s[0] === "/") return originOf(base) + s;
  return String(base || "").replace(/[^\/]*$/, "") + s;
}

function decodeHtmlEntities(s) {
  return String(s || "")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function (resolve) {
      setTimeout(function () {
        resolve(null);
      }, ms);
    }),
  ]);
}

// ---------- Base64 & Base64URL ----------
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64Bytes(input) {
  if (!input) return new Uint8Array(0);
  var clean = String(input).replace(/[^A-Za-z0-9+/=]/g, "");
  var out = [];
  var i = 0;
  while (i < clean.length) {
    var c1 = B64_CHARS.indexOf(clean.charAt(i++));
    var c2 = B64_CHARS.indexOf(clean.charAt(i++));
    var e3 = clean.charAt(i++);
    var e4 = clean.charAt(i++);
    var c3 = e3 === "=" ? 0 : B64_CHARS.indexOf(e3);
    var c4 = e4 === "=" ? 0 : B64_CHARS.indexOf(e4);
    if (c1 < 0 || c2 < 0) break;

    out.push((c1 << 2) | (c2 >> 4));
    if (e3 !== "=" && c3 >= 0) {
      out.push(((c2 & 15) << 4) | (c3 >> 2));
    }
    if (e4 !== "=" && c4 >= 0) {
      out.push(((c3 & 3) << 6) | c4);
    }
  }
  return new Uint8Array(out);
}

function decodeBase64(input) {
  var bytes = decodeBase64Bytes(input);
  var s = "";
  for (var i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

function decodeBase64UrlBytes(input) {
  var s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  var pad = s.length % 4;
  if (pad) s += "====".slice(pad);
  return decodeBase64Bytes(s);
}

// ---------- Pure-JS AES-256-CBC (QuickJS compatible) ----------
var AES_SBOX = [
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
];

var AES_INV_SBOX = (function () {
  var inv = new Array(256);
  for (var i = 0; i < 256; i++) inv[AES_SBOX[i]] = i;
  return inv;
})();

var AES_RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function gmul(a, b) {
  var p = 0;
  for (var i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    var hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function aes256KeyExpansion(keyBytes) {
  var w = new Array(60);
  for (var i = 0; i < 8; i++) {
    w[i] =
      ((keyBytes[4 * i] << 24) |
        (keyBytes[4 * i + 1] << 16) |
        (keyBytes[4 * i + 2] << 8) |
        keyBytes[4 * i + 3]) >>> 0;
  }
  for (var j = 8; j < 60; j++) {
    var temp = w[j - 1];
    if (j % 8 === 0) {
      temp =
        ((AES_SBOX[(temp >>> 16) & 0xff] << 24) |
          (AES_SBOX[(temp >>> 8) & 0xff] << 16) |
          (AES_SBOX[temp & 0xff] << 8) |
          AES_SBOX[(temp >>> 24) & 0xff]) >>> 0;
      temp ^= AES_RCON[j / 8] << 24;
    } else if (j % 8 === 4) {
      temp =
        ((AES_SBOX[(temp >>> 24) & 0xff] << 24) |
          (AES_SBOX[(temp >>> 16) & 0xff] << 16) |
          (AES_SBOX[(temp >>> 8) & 0xff] << 8) |
          AES_SBOX[temp & 0xff]) >>> 0;
    }
    w[j] = (w[j - 8] ^ temp) >>> 0;
  }
  return w;
}

function aes256DecryptBlock(block, w) {
  var s = [
    [block[0], block[1], block[2], block[3]],
    [block[4], block[5], block[6], block[7]],
    [block[8], block[9], block[10], block[11]],
    [block[12], block[13], block[14], block[15]],
  ];

  function addRoundKey(round) {
    for (var c = 0; c < 4; c++) {
      var word = w[round * 4 + c];
      s[c][0] ^= (word >>> 24) & 0xff;
      s[c][1] ^= (word >>> 16) & 0xff;
      s[c][2] ^= (word >>> 8) & 0xff;
      s[c][3] ^= word & 0xff;
    }
  }

  function invShiftRows() {
    var t;
    t = s[3][1]; s[3][1] = s[2][1]; s[2][1] = s[1][1]; s[1][1] = s[0][1]; s[0][1] = t;
    t = s[2][2]; s[2][2] = s[0][2]; s[0][2] = t;
    t = s[3][2]; s[3][2] = s[1][2]; s[1][2] = t;
    t = s[0][3]; s[0][3] = s[1][3]; s[1][3] = s[2][3]; s[2][3] = s[3][3]; s[3][3] = t;
  }

  function invSubBytes() {
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        s[c][r] = AES_INV_SBOX[s[c][r]];
      }
    }
  }

  function invMixColumns() {
    for (var c = 0; c < 4; c++) {
      var a0 = s[c][0], a1 = s[c][1], a2 = s[c][2], a3 = s[c][3];
      s[c][0] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
      s[c][1] = gmul(a0, 9)  ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
      s[c][2] = gmul(a0, 13) ^ gmul(a1, 9)  ^ gmul(a2, 14) ^ gmul(a3, 11);
      s[c][3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9)  ^ gmul(a3, 14);
    }
  }

  addRoundKey(14);
  for (var round = 13; round >= 1; round--) {
    invShiftRows();
    invSubBytes();
    addRoundKey(round);
    invMixColumns();
  }
  invShiftRows();
  invSubBytes();
  addRoundKey(0);

  return [
    s[0][0], s[0][1], s[0][2], s[0][3],
    s[1][0], s[1][1], s[1][2], s[1][3],
    s[2][0], s[2][1], s[2][2], s[2][3],
    s[3][0], s[3][1], s[3][2], s[3][3],
  ];
}

function padBytes(str, len) {
  var out = new Array(len);
  var s = String(str || "");
  for (var i = 0; i < len; i++) {
    out[i] = i < s.length ? s.charCodeAt(i) & 0xff : 0;
  }
  return out;
}

function decryptMegaPlayEnc(encStr) {
  if (!encStr) {
    DIAG.push("no_enc");
    return null;
  }
  var cipherBytes = decodeBase64UrlBytes(encStr);
  if (!cipherBytes.length || cipherBytes.length % 16 !== 0) {
    DIAG.push("enc_len:" + cipherBytes.length);
    return null;
  }

  var key = padBytes(SOURCE_ENC_KEY, 32);
  var iv = padBytes(SOURCE_ENC_IV, 16);
  var w = aes256KeyExpansion(key);

  var plain = new Array(cipherBytes.length);
  var prev = iv;

  for (var off = 0; off < cipherBytes.length; off += 16) {
    var block = new Array(16);
    for (var b = 0; b < 16; b++) block[b] = cipherBytes[off + b];
    var decBlock = aes256DecryptBlock(block, w);
    for (var j = 0; j < 16; j++) {
      plain[off + j] = decBlock[j] ^ prev[j];
    }
    prev = block;
  }

  var padLen = plain[plain.length - 1];
  if (padLen < 1 || padLen > 16) {
    DIAG.push("pad_err:" + padLen);
    return null;
  }
  for (var k = plain.length - padLen; k < plain.length; k++) {
    if (plain[k] !== padLen) {
      DIAG.push("pad_mismatch");
      return null;
    }
  }

  var text = "";
  for (var i = 0; i < plain.length - padLen; i++) {
    text += String.fromCharCode(plain[i]);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    DIAG.push("json_err");
    return null;
  }
}

// ---------- Metadata & ID resolution ----------
function normTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleSim(a, b) {
  var A = normTitle(a).split(" ").filter(Boolean);
  var B = normTitle(b).split(" ").filter(Boolean);
  if (!A.length || !B.length) return 0;
  var setB = {};
  for (var j = 0; j < B.length; j++) setB[B[j]] = 1;
  var hit = 0;
  for (var i = 0; i < A.length; i++) {
    if (setB[A[i]]) hit++;
  }
  return hit / Math.max(A.length, B.length, 1);
}

async function tmdbJson(path) {
  try {
    var sep = path.indexOf("?") >= 0 ? "&" : "?";
    var r = await fetch("https://api.themoviedb.org/3/" + path + sep + "api_key=" + TMDB_API_KEY, {
      headers: UA,
    });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function resolveTarget(rawId, mediaType, season, episode) {
  var s = String(rawId || "").trim().replace(/^tmdb:/i, "");
  var sn = Number(season) || 1;
  var ep = Number(episode) || 1;

  var tmdbId = null;
  var isTv = mediaType === "tv" || mediaType === "series" || mediaType === "anime";
  var extraTitles = [];

  if (/^\d+$/.test(s)) {
    tmdbId = Number(s);
    if (!mediaType) isTv = true;
  } else {
    var imdb = /^(tt\d+)/.exec(s);
    if (imdb) {
      var found = await withTimeout(tmdbJson("find/" + imdb[1] + "?external_source=imdb_id"), 4500);
      var tvHit = found && found.tv_results && found.tv_results[0];
      var movHit = found && found.movie_results && found.movie_results[0];
      var hit = tvHit || movHit;
      if (!hit) return null;
      tmdbId = Number(hit.id);
      isTv = !!tvHit;
    } else {
      var kitsu = /^kitsu:(\d+)(?::(\d+))?/.exec(s);
      if (!kitsu) return null;
      var kitsuId = kitsu[1];
      if (!episode && kitsu[2]) ep = Number(kitsu[2]) || 1;

      var kr = await withTimeout(
        fetch("https://kitsu.io/api/edge/anime/" + kitsuId, {
          headers: { Accept: "application/vnd.api+json" },
        }),
        4500
      );
      if (!kr || !kr.ok) return null;
      var kj = await kr.json();
      var attrs = (kj && kj.data && kj.data.attributes) || {};
      var titles = [
        attrs.titles && attrs.titles.en,
        attrs.canonicalTitle,
        attrs.titles && attrs.titles.en_jp,
      ].filter(Boolean);
      if (!titles.length) return null;
      extraTitles = titles;

      var isMovie = attrs.subtype === "movie" || mediaType === "movie";
      var best = null;

      for (var i = 0; i < titles.length; i++) {
        var q =
          titles[i]
            .replace(/\b(\d+)(st|nd|rd|th)\s+season\b/gi, " ")
            .replace(/\bseason\s*\d+\b/gi, " ")
            .replace(/\bpart\s*\d+\b/gi, " ")
            .replace(/\s+/g, " ")
            .trim() || titles[i];
        var endpoint = isMovie ? "search/movie" : "search/tv";
        var sr = await withTimeout(tmdbJson(endpoint + "?query=" + encodeURIComponent(q)), 4500);
        var list = (sr && sr.results) || [];
        for (var rIdx = 0; rIdx < Math.min(list.length, 6); rIdx++) {
          var item = list[rIdx];
          var sc = Math.max(
            titleSim(q, item.name || item.title),
            titleSim(q, item.original_name || item.original_title)
          );
          if (!best || sc > best.sc) best = { id: item.id, sc: sc };
        }
        if (best && best.sc >= 0.75) break;
      }

      if (!best || best.sc < 0.35) return null;
      tmdbId = Number(best.id);
      isTv = !isMovie;
    }
  }

  var details = await withTimeout(tmdbJson((isTv ? "tv/" : "movie/") + tmdbId), 4500);
  if (!details) {
    details = await withTimeout(tmdbJson((isTv ? "movie/" : "tv/") + tmdbId), 4500);
    if (details) isTv = !isTv;
  }

  var mainTitle =
    (details && (details.name || details.title || details.original_name || details.original_title)) || "";
  var candidates = [mainTitle].concat(extraTitles).filter(Boolean);

  if (!candidates.length) return null;

  return {
    tmdbId: tmdbId,
    isTv: isTv,
    season: sn,
    episode: ep,
    title: mainTitle || candidates[0],
    candidates: candidates,
  };
}

// ---------- Search & episode discovery on animotvslash.org ----------
function scoreAnimeUrl(url, titleCandidates, season) {
  var clean = String(url || "").toLowerCase();
  var slug = clean.replace(/^https?:\/\/[^\/]+\/anime\/|\/$/g, "").replace(/-/g, " ");
  var best = 0;
  for (var i = 0; i < titleCandidates.length; i++) {
    var cand = titleCandidates[i];
    var s = titleSim(cand, slug);
    if (season > 1) {
      if (slug.indexOf("season " + season) >= 0 || slug.indexOf("s" + season) >= 0) {
        s += 0.25;
      } else if (/season\s*\d+/.test(slug)) {
        s -= 0.15;
      }
    }
    if (s > best) best = s;
  }
  return best;
}

async function findEpisodePage(target) {
  var animeUrls = [];
  var seenAnime = {};

  for (var i = 0; i < target.candidates.length; i++) {
    var query = target.candidates[i]
      .replace(/\bseason\s*\d+\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!query) continue;

    try {
      var searchUrl = BASE + "/anime/?s=" + encodeURIComponent(query);
      var r = await fetch(searchUrl, { headers: PAGE_HEADERS });
      if (!r || !r.ok) continue;
      var html = await r.text();

      var re = /href=["'](https?:\/\/animotvslash\.org\/anime\/[^"'#?\/]+\/?)["']/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var u = decodeHtmlEntities(m[1]);
        if (!/\/anime\/?$/i.test(u) && !seenAnime[u]) {
          seenAnime[u] = 1;
          animeUrls.push(u);
        }
      }
      if (animeUrls.length >= 6) break;
    } catch (e) {}
  }

  if (!animeUrls.length) {
    DIAG.push("search:empty");
    return null;
  }

  animeUrls.sort(function (a, b) {
    return scoreAnimeUrl(b, target.candidates, target.season) - scoreAnimeUrl(a, target.candidates, target.season);
  });

  var bestAnime = animeUrls[0];
  DIAG.push("anime:" + bestAnime.replace(/^https?:\/\/animotvslash\.org\/anime\/|\/$/g, "").slice(0, 28));

  try {
    var ar = await fetch(bestAnime, { headers: PAGE_HEADERS });
    if (!ar || !ar.ok) {
      DIAG.push("anime_http:" + (ar ? ar.status : "0"));
      return null;
    }
    var aHtml = await ar.text();

    var epLinks = [];
    var seenEp = {};
    var epRe = /href=["'](https?:\/\/animotvslash\.org\/[^"'#?]+episode[^"'#?]*\/?)["']/gi;
    var em;
    while ((em = epRe.exec(aHtml)) !== null) {
      var eu = decodeHtmlEntities(em[1]);
      if (!seenEp[eu]) {
        seenEp[eu] = 1;
        epLinks.push(eu);
      }
    }

    if (!epLinks.length) {
      DIAG.push("no_ep_links");
      return null;
    }

    var epNum = target.episode;
    var exactMatch = null;
    var fallbackMatch = null;

    for (var k = 0; k < epLinks.length; k++) {
      var link = epLinks[k];
      var mEp = /(?:^|[-_])episode[-_]?0*(\d+)(?:[-_/]|$)/i.exec(link);
      if (mEp && parseInt(mEp[1], 10) === epNum) {
        if (target.season > 1) {
          if (link.indexOf("season-" + target.season) >= 0) {
            exactMatch = link;
            break;
          } else if (!fallbackMatch) {
            fallbackMatch = link;
          }
        } else {
          exactMatch = link;
          break;
        }
      }
    }

    var chosenEp = exactMatch || fallbackMatch || (!target.isTv ? epLinks[0] : null);
    if (!chosenEp) {
      DIAG.push("ep_not_found(" + epNum + ")");
      return null;
    }

    return chosenEp;
  } catch (e) {
    DIAG.push("anime_err");
    return null;
  }
}

// ---------- SoftSub mirrors & Arabic subtitles ----------
function parseSoftSubMirrors(epHtml) {
  var mirrors = [];
  var seen = {};

  var optRe = /<option[^>]*value=["']([A-Za-z0-9+/=]{20,})["'][^>]*>([\s\S]*?)<\/option>/gi;
  var m;
  while ((m = optRe.exec(epHtml)) !== null) {
    var b64 = m[1];
    var label = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
    if (!/softsub/i.test(label)) continue;

    var decoded = decodeBase64(b64);
    if (!decoded) continue;

    var srcMatch = /src=["']([^"'>]+)["']/i.exec(decoded);
    if (!srcMatch || !srcMatch[1]) continue;

    var src = decodeHtmlEntities(srcMatch[1].trim());
    if (!/^https?:\/\//i.test(src)) continue;

    if (!seen[src]) {
      seen[src] = 1;
      mirrors.push({
        label: label || "SoftSub",
        url: src,
      });
    }
  }

  return mirrors;
}

function isArabicSub(langVal, labelVal, urlVal) {
  var txt = (String(langVal || "") + " " + String(labelVal || "") + " " + String(urlVal || "")).toLowerCase();
  return (
    /\barabic\b/.test(txt) ||
    /\bar\b/.test(txt) ||
    /\bara\b/.test(txt) ||
    txt.indexOf("عرب") >= 0
  );
}

async function resolveMegaPlayMirror(mirrorUrl) {
  var res = { streams: [], arabicSubs: [], referer: mirrorUrl };
  try {
    var r = await fetch(mirrorUrl, {
      headers: Object.assign({}, UA, {
        Referer: BASE + "/",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }),
    });
    if (!r || !r.ok) {
      DIAG.push("mp_page:" + (r ? r.status : "0"));
      return res;
    }
    var html = await r.text();

    var dataIdMatch = /data-id=["'](\d+)["']/i.exec(html);
    if (!dataIdMatch) {
      DIAG.push("mp_no_id");
      return res;
    }
    var dataId = dataIdMatch[1];

    var baseMatch = /base_url\s*:\s*['"]([^'"]+)['"]/i.exec(html);
    var apiBase = baseMatch && baseMatch[1] ? baseMatch[1] : originOf(mirrorUrl) + "/";
    if (apiBase.charAt(apiBase.length - 1) !== "/") apiBase += "/";

    var typeMatch = /\btype\s*:\s*['"]([^'"]+)['"]/i.exec(html);
    var st = typeMatch && typeMatch[1] ? typeMatch[1].toLowerCase() : "sub";

    var apiUrl =
      apiBase +
      "stream/getSources?id=" +
      encodeURIComponent(dataId) +
      "&platform=OTHER&st=" +
      encodeURIComponent(st);

    var apiRes = await fetch(apiUrl, {
      headers: Object.assign({}, UA, {
        Referer: mirrorUrl,
        Accept: "application/json, text/plain, */*",
      }),
    });
    if (!apiRes || !apiRes.ok) {
      DIAG.push("mp_api:" + (apiRes ? apiRes.status : "0"));
      return res;
    }

    var data = await apiRes.json();
    if (!data) {
      DIAG.push("mp_empty_json");
      return res;
    }

    if (Array.isArray(data.tracks)) {
      for (var i = 0; i < data.tracks.length; i++) {
        var tr = data.tracks[i] || {};
        var tUrl = decodeHtmlEntities(tr.file || tr.url || "");
        var tLabel = tr.label || tr.name || "Arabic";
        if (tUrl && isArabicSub(tr.lang || tr.language, tLabel, tUrl)) {
          res.arabicSubs.push({
            url: tUrl,
            lang: "ar",
            label: tLabel,
          });
        }
      }
    }

    if (data.enc) {
      var dec = decryptMegaPlayEnc(data.enc);
      if (dec && typeof dec.file === "string" && dec.file) {
        var fileUrl = decodeHtmlEntities(dec.file);
        if (/\/master\.m3u8(?:\?|$)/i.test(fileUrl) && !/[?&]t=/.test(fileUrl) && (st === "sub" || st === "dub")) {
          fileUrl += (fileUrl.indexOf("?") >= 0 ? "&" : "?") + "t=" + encodeURIComponent(st);
        }
        res.streams.push(fileUrl);
      } else {
        DIAG.push("mp_dec_fail");
      }
    }

    if (!res.streams.length && Array.isArray(data.sources)) {
      for (var sIdx = 0; sIdx < data.sources.length; sIdx++) {
        var srcObj = data.sources[sIdx];
        var sUrl = typeof srcObj === "string" ? srcObj : (srcObj && (srcObj.file || srcObj.url)) || "";
        if (sUrl) res.streams.push(decodeHtmlEntities(sUrl));
      }
    }
  } catch (e) {
    DIAG.push("mp_err:" + String((e && e.message) || "err").slice(0, 16));
  }

  return res;
}

function extractDirectStreamsAndArabicSubs(html, mirrorUrl) {
  var clean = String(html || "").replace(/\\\//g, "/");
  var streams = [];
  var seenStream = {};
  var arabicSubs = [];
  var seenSub = {};

  var m3u8Re = /https?:\/\/[^'"\s<>\\]+\.m3u8[^'"\s<>\\]*/gi;
  var mm;
  while ((mm = m3u8Re.exec(clean)) !== null) {
    var su = decodeHtmlEntities(mm[0]);
    if (!seenStream[su]) {
      seenStream[su] = 1;
      streams.push(su);
    }
  }

  var subRe = /https?:\/\/[^'"\s<>\\]+\.(?:vtt|srt)(?:\?[^'"\s<>\\]*)?/gi;
  var sm;
  while ((sm = subRe.exec(clean)) !== null) {
    var subUrl = decodeHtmlEntities(sm[0]);
    if (isArabicSub("", "", subUrl) && !seenSub[subUrl]) {
      seenSub[subUrl] = 1;
      arabicSubs.push({
        url: subUrl,
        lang: "ar",
        label: "Arabic",
      });
    }
  }

  return { streams: streams, arabicSubs: arabicSubs, referer: mirrorUrl };
}

async function resolveSoftSubMirror(mirrorObj) {
  if (/megaplay\./i.test(mirrorObj.url)) {
    return await resolveMegaPlayMirror(mirrorObj.url);
  }

  var r = await fetch(mirrorObj.url, {
    headers: Object.assign({}, UA, {
      Referer: BASE + "/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }),
  });
  if (!r || !r.ok) return { streams: [], arabicSubs: [], referer: mirrorObj.url };
  var html = await r.text();
  return extractDirectStreamsAndArabicSubs(html, mirrorObj.url);
}

// ---------- HLS quality expansion ----------
async function expandHls(masterUrl, hdrs) {
  var out = [{ url: masterUrl, quality: "Auto", height: 0 }];
  try {
    var r = await fetch(masterUrl, { headers: hdrs });
    if (!r || !r.ok) return out;
    var txt = await r.text();
    if (txt.indexOf("#EXTM3U") !== 0) return out;
    if (txt.indexOf("#EXT-X-STREAM-INF") < 0) return out;

    var lines = txt.split(/\r?\n/);
    var byHeight = {};
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      var next = "";
      for (var k = i + 1; k < lines.length; k++) {
        var t = lines[k].trim();
        if (t && t[0] !== "#") {
          next = t;
          break;
        }
      }
      if (!next) continue;
      var res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      if (!res) continue;
      var h = Math.max(
        parseInt(res[2], 10),
        Math.round((parseInt(res[1], 10) * 9) / 16)
      );
      var bw = parseInt((/(?:^|[,:])BANDWIDTH=(\d+)/.exec(line) || [0, 0])[1], 10);
      if (!byHeight[h] || bw > byHeight[h].bw) {
        byHeight[h] = { url: absUrl(masterUrl, next), bw: bw };
      }
    }

    var hs = Object.keys(byHeight)
      .map(Number)
      .sort(function (x, y) {
        return y - x;
      });
    if (hs.length) {
      out[0].quality = "Auto (up to " + qualityLabel(hs[0]) + ")";
      out[0].height = hs[0];
      for (var idx = 0; idx < hs.length; idx++) {
        var hVal = hs[idx];
        out.push({
          url: byHeight[hVal].url,
          quality: qualityLabel(hVal),
          height: hVal,
        });
      }
    }
  } catch (e) {}
  return out;
}

// ---------- Entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  var dbg = [];
  DIAG.length = 0;

  var fail = function (m) {
    var msg = dbg.concat(m, DIAG).join(" > ");
    var out = [];
    for (var i = 0; i < 6; i++) {
      var part = msg.slice(i * 60, (i + 1) * 60);
      if (!part) break;
      out.push({
        name: "DBG" + (i + 1) + " " + part,
        title: msg,
        url: "https://debug.invalid/" + (i + 1),
        quality: "debug",
      });
    }
    return out;
  };

  try {
    var target = await resolveTarget(tmdbId, mediaType, season, episode);
    if (!target) return fail("bad id " + String(tmdbId).slice(0, 24));

    dbg.push(target.title + " S" + target.season + "E" + target.episode);

    var epPageUrl = await withTimeout(findEpisodePage(target), 8000);
    if (!epPageUrl) return fail("episode page not found");

    var epRes = await withTimeout(
      fetch(epPageUrl, { headers: PAGE_HEADERS }),
      6500
    );
    if (!epRes || !epRes.ok) {
      return fail("ep http " + (epRes ? epRes.status : "0"));
    }
    var epHtml = await epRes.text();

    var softMirrors = parseSoftSubMirrors(epHtml);
    if (!softMirrors.length) return fail("no SoftSub mirrors");
    DIAG.push("soft:" + softMirrors.length);

    var scanList = softMirrors.slice(0, MAX_SOFTSUB_SCAN);
    var resolvedList = await Promise.all(
      scanList.map(function (m) {
        return withTimeout(resolveSoftSubMirror(m), 7000);
      })
    );

    var collectedStreams = [];
    var collectedArSubs = [];
    var seenSubUrl = {};

    for (var i = 0; i < scanList.length; i++) {
      var mObj = scanList[i];
      var resObj = resolvedList[i];
      if (!resObj || !resObj.streams || !resObj.streams.length) {
        DIAG.push(mObj.label + ":no_m3u8");
        continue;
      }

      DIAG.push(mObj.label + ":ok(" + resObj.streams.length + ")");
      for (var sIdx = 0; sIdx < resObj.streams.length; sIdx++) {
        collectedStreams.push({
          label: mObj.label,
          url: resObj.streams[sIdx],
          referer: resObj.referer || mObj.url,
        });
      }

      for (var subIdx = 0; subIdx < resObj.arabicSubs.length; subIdx++) {
        var subItem = resObj.arabicSubs[subIdx];
        if (!seenSubUrl[subItem.url]) {
          seenSubUrl[subItem.url] = 1;
          collectedArSubs.push(subItem);
        }
      }
    }

    if (!collectedStreams.length) return fail("no m3u8 in SoftSub");

    var streams = [];
    var seenOutUrl = {};

    for (var cIdx = 0; cIdx < collectedStreams.length && streams.length < MAX_STREAMS; cIdx++) {
      var cs = collectedStreams[cIdx];
      var hdrs = Object.assign({}, UA, {
        Referer: cs.referer,
        Origin: originOf(cs.referer),
      });

      var expanded = await withTimeout(expandHls(cs.url, hdrs), 5000);
      var variants = Array.isArray(expanded) && expanded.length
        ? expanded
        : [{ url: cs.url, quality: "Auto", height: 0 }];

      variants.sort(function (a, b) {
        return (b.height || 0) - (a.height || 0);
      });

      for (var vIdx = 0; vIdx < variants.length && streams.length < MAX_STREAMS; vIdx++) {
        var v = variants[vIdx];
        if (!v || !v.url || seenOutUrl[v.url]) continue;
        seenOutUrl[v.url] = 1;

        streams.push({
          name: "AnimoTVSlash " + cs.label,
          title: "AnimoTVSlash " + cs.label + " - " + v.quality,
          url: v.url,
          quality: v.quality,
          headers: hdrs,
          subtitles: collectedArSubs,
          provider: "animotvslash",
        });
      }
    }

    return streams.length ? streams : fail("no playable streams");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams, DIAG };
