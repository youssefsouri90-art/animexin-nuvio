(function (root) {
  "use strict";

  var BASE_URLS = ["https://cartoony.net", "https://carateen.tv"];
  var VOD_ORIGIN = "https://vod.spacetoongo.com/asset";
  var PEGASUS_ORIGIN = "https://pegasus.5387692.xyz/api/hls";
  var KEY_STR = "7annaba3l_loves_crypto_safe_key!@";

  var DEFAULT_HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://cartoony.net/",
    "Origin": "https://cartoony.net"
  };

  // --- Pure JS AES-256-CBC ---
  var SBOX = [
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

  var INV_SBOX = new Array(256);
  for (var i = 0; i < 256; i++) {
    INV_SBOX[SBOX[i]] = i;
  }

  var RCON = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

  function strToUtf8Bytes(str) {
    var out = [];
    for (var j = 0; j < str.length; j++) {
      var code = str.charCodeAt(j);
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff && j + 1 < str.length) {
        var next = str.charCodeAt(++j);
        var cp = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff));
        out.push(
          0xf0 | ((cp >> 18) & 0x07),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      } else {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return out;
  }

  function utf8BytesToStr(bytes) {
    var out = "";
    var k = 0;
    while (k < bytes.length) {
      var b1 = bytes[k++];
      if (b1 < 0x80) {
        out += String.fromCharCode(b1);
      } else if (b1 >= 0xc0 && b1 < 0xe0 && k < bytes.length) {
        var b2 = bytes[k++];
        out += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
      } else if (b1 >= 0xe0 && b1 < 0xf0 && k + 1 < bytes.length) {
        var b2e = bytes[k++], b3e = bytes[k++];
        out += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2e & 0x3f) << 6) | (b3e & 0x3f));
      } else if (b1 >= 0xf0 && k + 2 < bytes.length) {
        var b2f = bytes[k++], b3f = bytes[k++], b4f = bytes[k++];
        var cp =
          ((b1 & 0x07) << 18) |
          ((b2f & 0x3f) << 12) |
          ((b3f & 0x3f) << 6) |
          (b4f & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 | ((cp >> 10) & 0x3ff), 0xdc00 | (cp & 0x3ff));
      }
    }
    return out;
  }

  function gmul(a, b) {
    var p = 0;
    for (var bit = 0; bit < 8; bit++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  }

  function expandKey256(keyBytes) {
    var w = new Array(240).fill(0);
    for (var k = 0; k < 32; k++) w[k] = keyBytes[k] || 0;
    var bytesGenerated = 32;
    var rconIter = 1;
    var temp = [0, 0, 0, 0];

    while (bytesGenerated < 240) {
      for (var t = 0; t < 4; t++) temp[t] = w[bytesGenerated - 4 + t];
      if (bytesGenerated % 32 === 0) {
        var tmp0 = temp[0];
        temp[0] = SBOX[temp[1]] ^ RCON[rconIter++];
        temp[1] = SBOX[temp[2]];
        temp[2] = SBOX[temp[3]];
        temp[3] = SBOX[tmp0];
      } else if (bytesGenerated % 32 === 16) {
        for (var s = 0; s < 4; s++) temp[s] = SBOX[temp[s]];
      }
      for (var x = 0; x < 4; x++) {
        w[bytesGenerated] = w[bytesGenerated - 32] ^ temp[x];
        bytesGenerated++;
      }
    }
    return w;
  }

  var EXPANDED_KEY = expandKey256(strToUtf8Bytes(KEY_STR));

  function decryptBlock16(block, roundKeys) {
    var s = block.slice(0, 16);

    function addRoundKey(round) {
      var off = round * 16;
      for (var r = 0; r < 16; r++) s[r] ^= roundKeys[off + r];
    }

    function invShiftRows() {
      var t;
      t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
      t = s[2]; s[2] = s[10]; s[10] = t;
      t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
    }

    function invSubBytes() {
      for (var idx = 0; idx < 16; idx++) s[idx] = INV_SBOX[s[idx]];
    }

    function invMixColumns() {
      for (var c = 0; c < 4; c++) {
        var i = c * 4;
        var a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
        s[i]     = gmul(a0, 0x0e) ^ gmul(a1, 0x0b) ^ gmul(a2, 0x0d) ^ gmul(a3, 0x09);
        s[i + 1] = gmul(a0, 0x09) ^ gmul(a1, 0x0e) ^ gmul(a2, 0x0b) ^ gmul(a3, 0x0d);
        s[i + 2] = gmul(a0, 0x0d) ^ gmul(a1, 0x09) ^ gmul(a2, 0x0e) ^ gmul(a3, 0x0b);
        s[i + 3] = gmul(a0, 0x0b) ^ gmul(a1, 0x0d) ^ gmul(a2, 0x09) ^ gmul(a3, 0x0e);
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
    return s;
  }

  function hexToBytes(hex) {
    var len = Math.floor(hex.length / 2);
    var out = new Array(len);
    for (var i = 0; i < len; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
    }
    return out;
  }

  function aes256CbcDecryptHex(ivHex, encHex) {
    var iv = hexToBytes(ivHex);
    var enc = hexToBytes(encHex);
    var out = [];
    var prev = iv.slice(0, 16);

    for (var offset = 0; offset < enc.length; offset += 16) {
      var chunk = enc.slice(offset, offset + 16);
      var dec = decryptBlock16(chunk, EXPANDED_KEY);
      for (var i = 0; i < 16; i++) {
        out.push((dec[i] ^ (prev[i] || 0)) & 0xff);
      }
      prev = chunk;
    }

    var pad = out.length > 0 ? out[out.length - 1] : 0;
    var end = pad > 0 && pad <= 16 && pad <= out.length ? out.length - pad : out.length;
    return utf8BytesToStr(out.slice(0, end));
  }

  // --- Network & Catalog ---
  var cachedCatalog = { ts: 0, base: BASE_URLS[0], shows: [] };

  function fetchTimeout(url, options, ms) {
    var timeoutMs = ms || 5000;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("Timeout"));
      }, timeoutMs);
      fetch(url, options || {})
        .then(function (res) {
          clearTimeout(timer);
          resolve(res);
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function decryptPayload(raw) {
    if (!raw) return null;
    var obj = raw;
    if (typeof raw === "string") {
      try {
        obj = JSON.parse(raw);
      } catch (e) {
        return raw;
      }
    }
    if (!obj || typeof obj !== "object" || !obj.iv || !obj.encryptedData) {
      return obj;
    }
    try {
      var decrypted = aes256CbcDecryptHex(obj.iv, obj.encryptedData);
      try {
        return JSON.parse(decrypted);
      } catch (e2) {
        return decrypted;
      }
    } catch (e3) {
      return null;
    }
  }

  async function fetchJsonDecrypted(url, headers) {
    try {
      var res = await fetchTimeout(url, { headers: headers || DEFAULT_HEADERS }, 6000);
      if (!res || !res.ok) return null;
      var text = await res.text();
      return decryptPayload(text);
    } catch (e) {
      return null;
    }
  }

  async function getCatalog() {
    var now = Date.now();
    if (cachedCatalog.shows.length > 0 && now - cachedCatalog.ts < 15 * 60 * 1000) {
      return cachedCatalog;
    }
    for (var i = 0; i < BASE_URLS.length; i++) {
      var base = BASE_URLS[i];
      var data = await fetchJsonDecrypted(base + "/api/sp/tvshows", DEFAULT_HEADERS);
      if (Array.isArray(data) && data.length > 0) {
        cachedCatalog = { ts: now, base: base, shows: data };
        return cachedCatalog;
      }
    }
    return cachedCatalog;
  }

  function normalizeText(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/[\u064b-\u065f\u0670]/g, "")
      .replace(/[إأآا]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/[^\u0600-\u06ffa-z0-9\s]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function isExcludedSubbedOrNonArabicDub(item) {
    var blob = normalizeText(
      [item && item.name, item && item.pref, item && item.tags, item && item.planet_name].join(" ")
    );
    return (
      blob.indexOf("مترجم") !== -1 ||
      blob.indexOf("انكليزي") !== -1 ||
      blob.indexOf("انجليزي") !== -1 ||
      blob.indexOf("english") !== -1 ||
      blob.indexOf("ياباني") !== -1 ||
      blob.indexOf("japanese") !== -1
    );
  }

  function scoreArabicDubMatch(item, queryTitles) {
    var score = 0;
    var normName = normalizeText(item && item.name);
    var normPref = normalizeText(item && item.pref);
    var normTags = normalizeText(item && item.tags);
    var combined = [normName, normPref, normTags].join(" ");

    var titleMatched = false;
    for (var i = 0; i < queryTitles.length; i++) {
      var q = normalizeText(queryTitles[i]);
      if (!q) continue;
      if (normName === q) {
        score += 120;
        titleMatched = true;
      } else if (normName.indexOf(q) !== -1) {
        score += 75;
        titleMatched = true;
      } else {
        var tokens = q.split(" ").filter(function (t) { return t.length > 1; });
        var hits = 0;
        for (var k = 0; k < tokens.length; k++) {
          if (combined.indexOf(tokens[k]) !== -1) hits++;
        }
        if (hits > 0) {
          score += hits * 18;
          if (hits >= Math.ceil(tokens.length / 2)) titleMatched = true;
        }
      }
    }

    if (!titleMatched) return 0;
    if (combined.indexOf("عربي") !== -1 || combined.indexOf("مدبلج") !== -1) score += 20;
    if (normName.indexOf("مدبلج") !== -1 || normPref.indexOf("مدبلج") !== -1) score += 15;
    return score;
  }

  async function resolveTmdbMeta(tmdbId, mediaType) {
    if (!tmdbId || isNaN(Number(tmdbId))) {
      return { titles: [String(tmdbId || "")], year: null };
    }
    var type = mediaType === "movie" ? "movie" : "tv";
    var apiKey = "439c478a771f35c05022f9feabcca01c";

    try {
      var results = await Promise.all([
        fetchTimeout("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + apiKey + "&language=ar-SA", {}, 4000)
          .then(function (r) { return r && r.ok ? r.json() : {}; })
          .catch(function () { return {}; }),
        fetchTimeout("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + apiKey + "&language=en-US", {}, 4000)
          .then(function (r) { return r && r.ok ? r.json() : {}; })
          .catch(function () { return {}; })
      ]);
      var arData = results[0] || {};
      var enData = results[1] || {};
      var rawTitles = [
        arData.title,
        arData.name,
        enData.title,
        enData.original_title,
        enData.name,
        enData.original_name
      ].filter(Boolean);
      var uniqueTitles = [];
      for (var i = 0; i < rawTitles.length; i++) {
        if (uniqueTitles.indexOf(rawTitles[i]) === -1) uniqueTitles.push(rawTitles[i]);
      }
      return { titles: uniqueTitles, year: null };
    } catch (e) {
      return { titles: [], year: null };
    }
  }

  async function probeStreamUrl(url) {
    try {
      var res = await fetchTimeout(
        url,
        {
          headers: {
            "User-Agent": DEFAULT_HEADERS["User-Agent"],
            "Referer": "https://cartoony.net/",
            "Origin": "https://cartoony.net",
            "Range": "bytes=0-128"
          }
        },
        3000
      );
      return Boolean(res && (res.ok || res.status === 206));
    } catch (e) {
      return false;
    }
  }

  async function buildEpisodeStreams(baseUrl, show, episodeDetail) {
    var streams = [];
    var seenUrls = [];
    var epNum = episodeDetail && episodeDetail.number != null ? episodeDetail.number : 1;
    var prefLabel = episodeDetail && episodeDetail.pref ? " - " + episodeDetail.pref : "";
    var baseTitle = show.name + " (Ep " + epNum + prefLabel + ")";

    var legacyEp = await fetchJsonDecrypted(
      baseUrl + "/api/episode?episodeId=" + episodeDetail.id,
      DEFAULT_HEADERS
    );
    var directUrl = legacyEp && legacyEp.streamUrl;
    if (
      typeof directUrl === "string" &&
      directUrl.indexOf("http") === 0 &&
      directUrl.indexOf("410 Gone") === -1
    ) {
      seenUrls.push(directUrl);
      streams.push({
        name: "Cartoony Dub",
        title: baseTitle + " [Direct]",
        url: directUrl,
        quality: "HD",
        headers: {
          "Referer": baseUrl + "/",
          "Origin": baseUrl,
          "User-Agent": DEFAULT_HEADERS["User-Agent"]
        }
      });
    }

    var ids = [
      episodeDetail && episodeDetail.video_id,
      episodeDetail && episodeDetail.v5_id,
      episodeDetail && episodeDetail.id
    ].filter(Boolean);

    var candidates = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      candidates.push(PEGASUS_ORIGIN + "/" + id + "/playlist.m3u8");
      candidates.push(VOD_ORIGIN + "/" + id + "/playlist.m3u8");
      candidates.push(VOD_ORIGIN + "/" + id + "/play_video/index.m3u8");
    }

    var uniqueCandidates = candidates.filter(function (u) {
      return seenUrls.indexOf(u) === -1;
    });

    var checks = await Promise.all(
      uniqueCandidates.map(function (u) {
        return probeStreamUrl(u).then(function (ok) {
          return { url: u, ok: ok };
        });
      })
    );

    for (var c = 0; c < checks.length; c++) {
      if (checks[c].ok && seenUrls.indexOf(checks[c].url) === -1) {
        seenUrls.push(checks[c].url);
        streams.push({
          name: "Cartoony Dub",
          title: baseTitle + " [HLS]",
          url: checks[c].url,
          quality: "Auto",
          headers: {
            "Referer": "https://cartoony.net/",
            "Origin": "https://cartoony.net",
            "User-Agent": DEFAULT_HEADERS["User-Agent"]
          }
        });
      }
    }

    return streams;
  }

  async function getStreams(tmdbId, mediaType, season, episode) {
    try {
      var meta = await resolveTmdbMeta(tmdbId, mediaType || "tv");
      var queryTitles = meta.titles.length ? meta.titles : [String(tmdbId || "")];
      if (!queryTitles.length || !queryTitles[0]) return [];

      var catalog = await getCatalog();
      var activeBase = catalog.base;
      var shows = catalog.shows || [];
      if (!shows.length) return [];

      var scored = [];
      for (var i = 0; i < shows.length; i++) {
        var s = shows[i];
        if (isExcludedSubbedOrNonArabicDub(s)) continue;
        var sc = scoreArabicDubMatch(s, queryTitles);
        if (sc >= 30) scored.push({ show: s, score: sc });
      }
      scored.sort(function (a, b) { return b.score - a.score; });

      var topCandidates = scored.slice(0, 2);
      var allStreams = [];

      for (var t = 0; t < topCandidates.length; t++) {
        var show = topCandidates[t].show;
        var episodes = await fetchJsonDecrypted(
          activeBase + "/api/sp/episodes?id=" + show.id,
          DEFAULT_HEADERS
        );
        if (!Array.isArray(episodes) || !episodes.length) continue;

        var targetEpNumber = mediaType === "movie" ? 1 : Number(episode || 1);
        var matchedEp = null;
        for (var e = 0; e < episodes.length; e++) {
          if (Number(episodes[e].number) === targetEpNumber) {
            matchedEp = episodes[e];
            break;
          }
        }
        if (!matchedEp) matchedEp = episodes[0];
        if (!matchedEp || !matchedEp.id) continue;

        var detail =
          (await fetchJsonDecrypted(
            activeBase + "/api/sp/episode?episodeId=" + matchedEp.id,
            DEFAULT_HEADERS
          )) || matchedEp;

        if (isExcludedSubbedOrNonArabicDub(detail)) continue;

        var epStreams = await buildEpisodeStreams(activeBase, show, detail);
        for (var st = 0; st < epStreams.length; st++) {
          allStreams.push(epStreams[st]);
        }
      }

      return allStreams;
    } catch (e) {
      return [];
    }
  }

  root.getStreams = getStreams;
})(typeof globalThis !== "undefined" ? globalThis : this);
