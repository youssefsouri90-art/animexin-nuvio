const BASE_URL = "https://net52.cc";
const VERIFY_ORIGIN = "https://net22.cc";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

const NEWTV_DOMAIN_SEEDS_B64 = [
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

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36 /OS.Gatu v3.0";
const NEWTV_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0";
const PLAY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const OTT = "nf";
const API_TTL = 86400000;
const TOKEN_TTL = 3600000;

const memCache = {};

function cacheGet(key, ttl) {
  const entry = memCache[key];
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
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const input = String(str || "").replace(/[^A-Za-z0-9+/=]/g, "");
  let output = "";
  let i = 0;
  while (i < input.length) {
    const enc1 = chars.indexOf(input.charAt(i++));
    const enc2 = chars.indexOf(input.charAt(i++));
    const enc3 = chars.indexOf(input.charAt(i++));
    const enc4 = chars.indexOf(input.charAt(i++));
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    output += String.fromCharCode(chr1);
    if (enc3 !== 64) output += String.fromCharCode(chr2);
    if (enc4 !== 64) output += String.fromCharCode(chr3);
  }
  return output;
}

function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}

function dedupeTitles(list) {
  const seen = {};
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (t) {
    const clean = String(t || "").trim();
    if (!clean) return;
    const key = normText(clean);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(clean);
    const stripped = clean.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, " ").replace(/\s+/g, " ").trim();
    const sKey = normText(stripped);
    if (stripped && sKey && !seen[sKey]) {
      seen[sKey] = true;
      out.push(stripped);
    }
  });
  return out;
}

async function safeJson(url, options) {
  try {
    const res = await fetch(url, options || {});
    if (!res || !res.ok) return null;
    const txt = await res.text();
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

function nfHeaders() {
  return {
    "User-Agent": MOBILE_UA,
    "Accept": "application/json, text/plain, */*",
    "Referer": BASE_URL + "/",
    "Origin": VERIFY_ORIGIN,
    "X-Requested-With": "XMLHttpRequest"
  };
}

async function fetchTmdbMeta(cleanNumeric, endpoint) {
  const j = await safeJson(
    "https://api.themoviedb.org/3/" +
      endpoint +
      "/" +
      cleanNumeric +
      "?api_key=" +
      TMDB_API_KEY +
      "&append_to_response=alternative_titles"
  );
  if (!j) return { titles: [], year: null };

  const titles = [j.name || j.title, j.original_name || j.original_title].filter(Boolean);
  const alt =
    (j.alternative_titles && (j.alternative_titles.results || j.alternative_titles.titles)) || [];
  alt.forEach(function (a) {
    if (a && a.title) titles.push(a.title);
  });

  const dateStr = j.release_date || j.first_air_date || "";
  const year = dateStr ? Number(dateStr.slice(0, 4)) : null;
  return { titles: dedupeTitles(titles), year: year };
}

async function resolveTitlesFromId(id, mediaType) {
  const raw = String(id || "").trim();
  if (!raw) return { titles: [], year: null };

  const cleanNumeric = raw.replace(/^(tmdb[:_-]?|tt)/i, "").trim();
  if (!/^\d+$/.test(cleanNumeric)) {
    const cleanedText = raw.replace(/^(series|movie|show|nf)[:_-]/i, "").replace(/[-_]+/g, " ").trim();
    return { titles: cleanedText ? [cleanedText] : [], year: null };
  }

  const primaryType = mediaType === "movie" ? "movie" : "tv";
  const primary = await fetchTmdbMeta(cleanNumeric, primaryType);
  if (primary.titles.length) return primary;

  const fallbackType = primaryType === "movie" ? "tv" : "movie";
  return await fetchTmdbMeta(cleanNumeric, fallbackType);
}

function scoreHit(item, titles, year) {
  const title = item && (item.t || item.title || item.name);
  const nt = normText(title);
  if (!nt) return 0;

  let best = 0;
  titles.forEach(function (q, idx) {
    const nq = normText(q);
    if (!nq) return;
    const boost = idx === 0 ? 1.1 : 1.0;
    if (nt === nq) best = Math.max(best, 100 * boost);
    else if (nt.indexOf(nq) !== -1 || nq.indexOf(nt) !== -1) best = Math.max(best, 80 * boost);
    else {
      const toks = nq.split(" ").filter(function (w) { return w.length > 2; });
      if (toks.length) {
        let hits = 0;
        toks.forEach(function (tok) {
          if ((" " + nt + " ").indexOf(" " + tok + " ") !== -1) hits++;
        });
        if (hits > 0) best = Math.max(best, (hits / toks.length) * 65 * boost);
      }
    }
  });

  const itemYear = Number(item && (item.y || item.year));
  if (year && itemYear) {
    if (year === itemYear) best += 15;
    else if (Math.abs(year - itemYear) <= 1) best += 8;
  }

  return best;
}

async function searchNetMirror(titles, year) {
  for (let i = 0; i < titles.length; i++) {
    const q = titles[i];
    const url = BASE_URL + "/mobile/search.php?s=" + encodeURIComponent(q) + "&t=" + Date.now();
    const json = await safeJson(url, { method: "GET", headers: nfHeaders() });
    if (!json) continue;
    if (String(json.head || "").toLowerCase().indexOf("top searches") !== -1) continue;

    const list = Array.isArray(json.searchResult) ? json.searchResult : [];
    let winner = null;
    let bestScore = 0;

    list.forEach(function (item) {
      const sc = scoreHit(item, titles, year);
      if (sc > bestScore) {
        bestScore = sc;
        winner = item;
      }
    });

    if (winner && winner.id && bestScore >= 20) {
      return winner;
    }
  }
  return null;
}

async function resolveEpisodeId(postId, season, episode) {
  const postUrl = BASE_URL + "/mobile/post.php?id=" + encodeURIComponent(postId) + "&t=" + Date.now();
  const postData = await safeJson(postUrl, { method: "GET", headers: nfHeaders() });
  if (!postData) return String(postId);

  let episodes = Array.isArray(postData.episodes) ? postData.episodes : [];
  const seasons = Array.isArray(postData.season) ? postData.season : [];
  const sNum = Number(season) || 1;
  const eNum = Number(episode) || 1;

  if (seasons.length > 0) {
    const targetSeason =
      seasons.find(function (s) { return String(s.s || s.id) === String(sNum); }) ||
      seasons[Math.max(0, sNum - 1)] ||
      seasons[0];

    if (targetSeason && targetSeason.id) {
      const epUrl =
        BASE_URL +
        "/mobile/episodes.php?s=" +
        encodeURIComponent(targetSeason.id) +
        "&series=" +
        encodeURIComponent(postId) +
        "&t=" +
        Date.now() +
        "&page=1";
      const sJson = await safeJson(epUrl, { method: "GET", headers: nfHeaders() });
      if (sJson && Array.isArray(sJson.episodes) && sJson.episodes.length > 0) {
        episodes = sJson.episodes;
      }
    }
  }

  if (!episodes.length) return String(postId);

  const matched =
    episodes.find(function (ep) {
      const n = ep && (ep.ep || ep.episode || ep.number);
      return n != null && Number(String(n).replace(/\D+/g, "")) === eNum;
    }) || episodes[Math.max(0, eNum - 1)] || episodes[0];

  return String((matched && (matched.id || matched.ep_id)) || postId);
}

async function resolveApiBase(force) {
  if (!force) {
    const cached = cacheGet("nf_newtv_api", API_TTL);
    if (cached) return cached;
  }

  const headers = {
    "X-Requested-With": "NetmirrorNewTV v1.0",
    "User-Agent": NEWTV_UA,
    "Accept": "application/json, text/plain, */*"
  };

  for (let i = 0; i < NEWTV_DOMAIN_SEEDS_B64.length; i++) {
    const domain = base64Decode(NEWTV_DOMAIN_SEEDS_B64[i]).replace(/\/+$/, "");
    if (!domain) continue;
    const j = await safeJson(domain + "/checknewtv.php", { method: "GET", headers: headers });
    if (j && j.token_hash && String(j.token_hash).trim()) {
      const resolved = base64Decode(String(j.token_hash).trim()).replace(/\/+$/, "");
      if (resolved) {
        cacheSet("nf_newtv_api", resolved);
        return resolved;
      }
    }
  }
  return null;
}

async function resolveUserToken(apiBase, force) {
  const key = "nf_newtv_token_" + OTT;
  if (!force) {
    const cached = cacheGet(key, TOKEN_TTL);
    if (cached) return cached;
  }

  const j = await safeJson(apiBase + "/newtv/otp.php", {
    method: "GET",
    headers: {
      "accept": "application/json, text/plain, */*",
      "otp": "111111",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.Gatu v1.0"
    }
  });

  if (j && j.usertoken) {
    cacheSet(key, j.usertoken);
    return j.usertoken;
  }
  return null;
}

async function requestPlayer(mediaId) {
  const apiBase = await resolveApiBase(false);
  if (!apiBase) return null;

  const url = apiBase + "/newtv/player.php?id=" + encodeURIComponent(mediaId);

  async function runOnce(forceToken) {
    const token = await resolveUserToken(apiBase, forceToken);
    if (!token) return null;
    return await safeJson(url, {
      method: "GET",
      headers: {
        "Ott": OTT,
        "Usertoken": token,
        "X-Requested-With": "NetmirrorNewTV v1.0",
        "User-Agent": NEWTV_UA
      }
    });
  }

  let data = await runOnce(false);
  if (!data || !data.video_link) {
    data = await runOnce(true);
  }
  return data;
}

function mapSubtitles(data) {
  const raw = data && (data.subtitles || data.subtitle || data.tracks);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(function (s) { return s && (s.url || s.file || s.src); })
    .map(function (s) {
      const label = String(s.label || s.name || s.language || s.lang || "Subtitle");
      return {
        url: String(s.url || s.file || s.src),
        language: String(s.language || s.lang || label),
        name: label
      };
    });
}

async function getStreams(id, mediaType, season, episode) {
  try {
    const isMovie = mediaType === "movie";
    const meta = await resolveTitlesFromId(id, mediaType);
    if (!meta.titles.length) return [];

    const match = await searchNetMirror(meta.titles, meta.year);
    if (!match || !match.id) return [];

    const postId = String(match.id);
    const targetId = isMovie ? postId : await resolveEpisodeId(postId, season, episode);

    let player = await requestPlayer(targetId);
    if ((!player || !player.video_link) && targetId !== postId) {
      player = await requestPlayer(postId);
    }
    if (!player || !player.video_link) return [];

    const baseTitle = match.t || match.title || meta.titles[0];
    const epLabel = isMovie ? "" : " S" + (Number(season) || 1) + "E" + (Number(episode) || 1);

    return [
      {
        name: "Netflix",
        title: baseTitle + epLabel,
        quality: "Auto",
        url: String(player.video_link),
        headers: {
          "Referer": player.referer || BASE_URL,
          "User-Agent": PLAY_UA
        },
        subtitles: mapSubtitles(player)
      }
    ];
  } catch (e) {
    return [];
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
