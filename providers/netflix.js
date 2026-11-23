(function (root) {
  "use strict";

  var BASE_URL = "https://net52.cc";
  var VERIFY_ORIGIN = "https://net22.cc";
  var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

  var NEWTV_DOMAIN_SEEDS_B64 = [
    "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
    "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
  ];

  var MOBILE_UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36 /OS.Gatu v3.0";
  var NEWTV_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0";
  var PLAY_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

  var API_TTL = 86400000;
  var TOKEN_TTL = 3600000;
  var OTT = "nf";

  var memCache = {};
  var tmdbCache = {};

  function cacheGet(key, ttl) {
    var entry = memCache[key];
    if (!entry) return null;
    if (Date.now() - entry.ts > ttl) {
      delete memCache[key];
      return null;
    }
    return entry.val;
  }

  function cacheSet(key, val) {
    memCache[key] = { ts: Date.now(), val: val };
  }

  function base64Decode(str) {
    if (typeof atob === "function") return atob(str);
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var input = String(str || "").replace(/[^A-Za-z0-9\+\/\=]/g, "");
    var output = "";
    var i = 0;
    while (i < input.length) {
      var enc1 = chars.indexOf(input.charAt(i++));
      var enc2 = chars.indexOf(input.charAt(i++));
      var enc3 = chars.indexOf(input.charAt(i++));
      var enc4 = chars.indexOf(input.charAt(i++));
      var chr1 = (enc1 << 2) | (enc2 >> 4);
      var chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      var chr3 = ((enc3 & 3) << 6) | enc4;
      output += String.fromCharCode(chr1);
      if (enc3 !== 64) output += String.fromCharCode(chr2);
      if (enc4 !== 64) output += String.fromCharCode(chr3);
    }
    return output;
  }

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

  async function fetchJson(url, headers, ms) {
    try {
      var res = await fetchTimeout(url, { method: "GET", headers: headers || {} }, ms || 5000);
      if (!res || !res.ok) return null;
      var text = await res.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        return null;
      }
    } catch (e) {
      return null;
    }
  }

  function nfHeaders(extra) {
    var h = {
      "User-Agent": MOBILE_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": BASE_URL + "/",
      "Origin": VERIFY_ORIGIN,
      "X-Requested-With": "XMLHttpRequest"
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
      }
    }
    return h;
  }

  async function resolveNewTvApiUrl(force) {
    if (!force) {
      var cached = cacheGet("newtv_api", API_TTL);
      if (cached) return cached;
    }
    var headers = {
      "X-Requested-With": "NetmirrorNewTV v1.0",
      "User-Agent": NEWTV_UA,
      "Accept": "application/json, text/plain, */*"
    };
    for (var i = 0; i < NEWTV_DOMAIN_SEEDS_B64.length; i++) {
      var domain = "";
      try {
        domain = base64Decode(NEWTV_DOMAIN_SEEDS_B64[i]).replace(/\/+$/, "");
      } catch (e) {
        continue;
      }
      if (!domain) continue;
      var json = await fetchJson(domain + "/checknewtv.php", headers, 3500);
      if (json && json.token_hash && String(json.token_hash).trim()) {
        try {
          var resolved = base64Decode(String(json.token_hash).trim()).replace(/\/+$/, "");
          if (resolved) {
            cacheSet("newtv_api", resolved);
            return resolved;
          }
        } catch (e2) {}
      }
    }
    throw new Error("Failed to resolve NewTV API base URL");
  }

  async function getNewTvUserToken(force) {
    var cacheKey = "newtv_token_" + OTT;
    if (!force) {
      var cached = cacheGet(cacheKey, TOKEN_TTL);
      if (cached) return cached;
    }
    var apiBase = await resolveNewTvApiUrl(false);
    var json = await fetchJson(
      apiBase + "/newtv/otp.php",
      {
        "accept": "application/json, text/plain, */*",
        "otp": "111111",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.Gatu v1.0"
      },
      4500
    );
    if (json && json.usertoken) {
      cacheSet(cacheKey, json.usertoken);
      return json.usertoken;
    }
    throw new Error("Failed to obtain playback usertoken");
  }

  function parseSubtitles(json) {
    var raw = json && (json.subtitles || json.subtitle || json.tracks);
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (!s || typeof s !== "object") continue;
      var url = s.url || s.file || s.src;
      if (!url) continue;
      var label = s.label || s.name || s.language || s.lang || "Subtitle";
      out.push({
        url: String(url),
        language: String(s.language || s.lang || label),
        name: String(label)
      });
    }
    return out;
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

  function pushUniqueTitle(list, val) {
    var clean = String(val || "").trim();
    if (clean && list.indexOf(clean) === -1) list.push(clean);
  }

  async function resolveTmdbMeta(tmdbId, mediaType) {
    var kind = mediaType === "movie" ? "movie" : "tv";
    var cacheKey = kind + ":" + String(tmdbId || "");
    if (tmdbCache[cacheKey]) return tmdbCache[cacheKey];

    if (!tmdbId || isNaN(Number(tmdbId))) {
      var fallback = { titles: [String(tmdbId || "")], year: null };
      tmdbCache[cacheKey] = fallback;
      return fallback;
    }

    var endpoint = kind === "movie" ? "movie" : "tv";
    var base = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId;
    var results = await Promise.all([
      fetchJson(base + "?api_key=" + TMDB_API_KEY + "&language=en-US", {}, 3500),
      fetchJson(base + "?api_key=" + TMDB_API_KEY + "&language=ar-SA", {}, 3500),
      fetchJson(base + "/alternative_titles?api_key=" + TMDB_API_KEY, {}, 3500)
    ]);

    var enData = results[0] || {};
    var arData = results[1] || {};
    var altData = results[2] || {};
    var titles = [];

    pushUniqueTitle(titles, enData.title);
    pushUniqueTitle(titles, enData.name);
    pushUniqueTitle(titles, enData.original_title);
    pushUniqueTitle(titles, enData.original_name);
    pushUniqueTitle(titles, arData.title);
    pushUniqueTitle(titles, arData.name);

    var altList = altData.titles || altData.results || [];
    for (var i = 0; i < altList.length; i++) {
      pushUniqueTitle(titles, altList[i] && altList[i].title);
      pushUniqueTitle(titles, altList[i] && altList[i].name);
    }

    var dateStr = enData.release_date || enData.first_air_date || arData.release_date || arData.first_air_date || "";
    var year = dateStr ? Number(dateStr.slice(0, 4)) : null;

    var out = { titles: titles, year: year };
    tmdbCache[cacheKey] = out;
    return out;
  }

  function scoreSearchItem(item, queryTitles, year) {
    var title = item && (item.t || item.title || item.name);
    var normTitle = normalizeText(title);
    if (!normTitle) return 0;

    var score = 0;
    for (var i = 0; i < queryTitles.length; i++) {
      var q = normalizeText(queryTitles[i]);
      if (!q) continue;
      if (normTitle === q) score = Math.max(score, 120);
      else if (normTitle.indexOf(q) !== -1 || q.indexOf(normTitle) !== -1) {
        score = Math.max(score, 85);
      } else {
        var tokens = q.split(" ").filter(function (t) { return t.length > 1; });
        var hits = 0;
        for (var k = 0; k < tokens.length; k++) {
          if (normTitle.indexOf(tokens[k]) !== -1) hits++;
        }
        if (hits > 0) score = Math.max(score, hits * 20);
      }
    }

    var itemYear = Number(item && (item.y || item.year));
    if (year && itemYear) {
      if (year === itemYear) score += 20;
      else if (Math.abs(year - itemYear) <= 1) score += 10;
    }

    return score;
  }

  async function searchNetflix(queryTitles, year) {
    for (var i = 0; i < queryTitles.length; i++) {
      var q = String(queryTitles[i] || "").trim();
      if (!q) continue;
      var url = BASE_URL + "/mobile/search.php?s=" + encodeURIComponent(q) + "&t=" + Date.now();
      var json = await fetchJson(url, nfHeaders(), 4500);
      var list = (json && Array.isArray(json.searchResult)) ? json.searchResult : [];
      if (!list.length) continue;

      var best = null;
      var bestScore = 0;
      for (var j = 0; j < list.length; j++) {
        var sc = scoreSearchItem(list[j], queryTitles, year);
        if (sc > bestScore) {
          bestScore = sc;
          best = list[j];
        }
      }
      if (best && best.id && bestScore >= 40) {
        return best;
      }
    }
    return null;
  }

  async function resolveEpisodeId(postData, postId, seasonNum, episodeNum) {
    var episodes = Array.isArray(postData && postData.episodes) ? postData.episodes : [];
    var seasons = Array.isArray(postData && postData.season) ? postData.season : [];

    if (seasons.length > 0) {
      var targetSeason =
        seasons.find(function (s) { return String(s.s || s.id) === String(seasonNum); }) ||
        seasons[Math.max(0, Number(seasonNum || 1) - 1)] ||
        seasons[0];

      if (targetSeason && targetSeason.id) {
        var epUrl =
          BASE_URL +
          "/mobile/episodes.php?s=" +
          encodeURIComponent(targetSeason.id) +
          "&series=" +
          encodeURIComponent(postId) +
          "&t=" +
          Date.now() +
          "&page=1";
        var sJson = await fetchJson(epUrl, nfHeaders(), 4500);
        if (sJson && Array.isArray(sJson.episodes) && sJson.episodes.length > 0) {
          episodes = sJson.episodes;
        }
      }
    }

    if (!episodes.length) return String(postId);

    var targetEp = Number(episodeNum || 1);
    var matched =
      episodes.find(function (ep) {
        var n = ep && (ep.ep || ep.episode || ep.number);
        return n != null && Number(String(n).replace(/\D+/g, "")) === targetEp;
      }) || episodes[Math.max(0, targetEp - 1)] || episodes[0];

    return String((matched && (matched.id || matched.ep_id)) || postId);
  }

  async function fetchNewTvPlayer(mediaId) {
    var apiBase = await resolveNewTvApiUrl(false);
    var playerUrl = apiBase + "/newtv/player.php?id=" + encodeURIComponent(mediaId);

    async function tryFetch(forceToken) {
      var token = await getNewTvUserToken(forceToken);
      return await fetchJson(
        playerUrl,
        {
          "Ott": OTT,
          "Usertoken": token,
          "X-Requested-With": "NetmirrorNewTV v1.0",
          "User-Agent": NEWTV_UA
        },
        5000
      );
    }

    var json = await tryFetch(false);
    if (!json || !json.video_link) {
      json = await tryFetch(true);
    }
    return json;
  }

  async function getStreams(tmdbId, mediaType, season, episode) {
    try {
      var kind = mediaType === "movie" ? "movie" : "tv";
      var meta = await resolveTmdbMeta(tmdbId, kind);
      var queryTitles = meta.titles.length ? meta.titles : [String(tmdbId || "")];
      if (!queryTitles.length || !queryTitles[0]) return [];

      var found = await searchNetflix(queryTitles, meta.year);
      if (!found || !found.id) return [];

      var postId = String(found.id);
      var targetId = postId;

      if (kind !== "movie") {
        var postUrl = BASE_URL + "/mobile/post.php?id=" + encodeURIComponent(postId) + "&t=" + Date.now();
        var postData = await fetchJson(postUrl, nfHeaders(), 4500);
        targetId = await resolveEpisodeId(postData, postId, season || 1, episode || 1);
      }

      var playerJson = await fetchNewTvPlayer(targetId);
      if (!playerJson || !playerJson.video_link) return [];

      var titleLabel = found.t || found.title || queryTitles[0];
      if (kind !== "movie") {
        titleLabel += " S" + String(season || 1) + "E" + String(episode || 1);
      }

      return [
        {
          name: "Netflix (NetMirror)",
          title: titleLabel,
          url: String(playerJson.video_link),
          quality: "Auto",
          headers: {
            "Referer": playerJson.referer || BASE_URL,
            "User-Agent": PLAY_UA
          },
          subtitles: parseSubtitles(playerJson)
        }
      ];
    } catch (e) {
      return [];
    }
  }

  root.getStreams = getStreams;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
