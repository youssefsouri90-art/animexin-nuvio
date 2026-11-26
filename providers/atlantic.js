// Atlantic (atlantic.bz) provider for Nuvio (QuickJS: no DOM, no Node APIs).
// Flow: TMDB metadata -> GET pal.hls.lol/fs/embed (with atlantic.bz headers)
//       -> extract m3u8 from embeds + expand HLS -> Arabic subtitles (vdrk + natsuki)

const BASE = "https://atlantic.bz";
const PAL_EMBED_URL = "https://pal.hls.lol/fs/embed";
const SUB_VDRK_BASE = "https://sub.vdrk.site/v1";
const SUB_NATSUKI_URL = "https://natsuki.hls.lol/subs";
const TMDB_API_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
};

const ATLANTIC_HEADERS = Object.assign({}, UA, {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
  Origin: BASE,
  Referer: BASE + "/",
});

const MAX_EMBEDS_TO_SCAN = 10;
const MAX_STREAMS = 12;
const DIAG = [];

function hostOf(u) {
  var m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || ""));
  return m ? m[1] : String(u || "");
}

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

// ---------- TMDB & ID resolution ----------
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

async function resolveMediaTarget(rawId, mediaType, season, episode) {
  var s = String(rawId || "").trim().replace(/^tmdb:/i, "");
  var sn = Number(season) || 1;
  var ep = Number(episode) || 1;

  var tmdbId = null;
  var isTv = mediaType === "tv" || mediaType === "series" || mediaType === "anime";

  if (/^\d+$/.test(s)) {
    tmdbId = Number(s);
    if (!mediaType) isTv = false;
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

      if (isTv) {
        var seasonHint = null;
        for (var tIdx = 0; tIdx < titles.length; tIdx++) {
          var mSeason = /(\d+)(?:st|nd|rd|th)\s+season|season\s*(\d+)/i.exec(titles[tIdx]);
          if (mSeason) {
            seasonHint = parseInt(mSeason[1] || mSeason[2], 10);
            break;
          }
        }
        if (seasonHint) {
          sn = seasonHint;
        } else {
          var det = await withTimeout(tmdbJson("tv/" + tmdbId), 4500);
          var seasons = ((det && det.seasons) || []).filter(function (x) {
            return x.season_number > 0;
          });
          var left = ep;
          for (var sIdx = 0; sIdx < seasons.length; sIdx++) {
            var sObj = seasons[sIdx];
            if (left <= sObj.episode_count) {
              sn = sObj.season_number;
              ep = left;
              break;
            }
            left -= sObj.episode_count;
          }
        }
      }
    }
  }

  var details = await withTimeout(
    tmdbJson((isTv ? "tv/" : "movie/") + tmdbId + "?append_to_response=external_ids"),
    4500
  );
  var title =
    (details && (details.title || details.name || details.original_title || details.original_name)) || "";
  var dateStr = (details && (details.release_date || details.first_air_date)) || "";
  var year = /^\d{4}/.test(dateStr) ? dateStr.slice(0, 4) : "";
  var imdbId =
    (details &&
      ((details.external_ids && details.external_ids.imdb_id) || details.imdb_id)) ||
    "";

  if (!title) return null;

  return {
    tmdbId: tmdbId,
    imdbId: imdbId,
    isTv: isTv,
    type: isTv ? "tv" : "movie",
    season: sn,
    episode: ep,
    title: title,
    year: year,
  };
}

// ---------- Arabic subtitles (vdrk + natsuki) ----------
function isArabicSubText(langVal, labelVal, nameVal) {
  var lang = String(langVal || "").toLowerCase().trim();
  var label = String(labelVal || "").toLowerCase();
  var name = String(nameVal || "").toLowerCase();
  var combined = lang + " " + label + " " + name;
  return (
    lang === "ar" ||
    lang === "ara" ||
    lang.indexOf("ar-") === 0 ||
    lang.indexOf("arabic") >= 0 ||
    combined.indexOf("arabic") >= 0 ||
    combined.indexOf("عرب") >= 0
  );
}

async function fetchVdrkArabicSubs(target) {
  try {
    var path = target.isTv
      ? SUB_VDRK_BASE + "/tv/" + target.tmdbId + "/" + target.season + "/" + target.episode
      : SUB_VDRK_BASE + "/movie/" + target.tmdbId;
    var r = await fetch(path, { headers: UA });
    if (!r || !r.ok) return [];
    var arr = await r.json();
    if (!Array.isArray(arr)) return [];

    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var subUrl = item && (item.file || item.url);
      if (!subUrl) continue;
      if (isArabicSubText(item.lang, item.label, item.name)) {
        out.push({
          url: subUrl,
          lang: "ar",
          label: item.label || "Arabic",
          source: "vdrk",
        });
      }
    }
    return out;
  } catch (e) {
    return [];
  }
}

async function fetchNatsukiArabicSubs(target) {
  var queries = [];
  if (target.tmdbId) {
    var p1 = "tmdbId=" + encodeURIComponent(String(target.tmdbId));
    if (target.isTv) {
      p1 += "&season=" + encodeURIComponent(String(target.season)) + "&episode=" + encodeURIComponent(String(target.episode));
    }
    queries.push(p1);
  }
  if (target.imdbId) {
    var p2 = "imdbId=" + encodeURIComponent(String(target.imdbId));
    if (target.isTv) {
      p2 += "&season=" + encodeURIComponent(String(target.season)) + "&episode=" + encodeURIComponent(String(target.episode));
    }
    queries.push(p2);
  }

  var out = [];
  for (var qIdx = 0; qIdx < queries.length; qIdx++) {
    try {
      var r = await fetch(SUB_NATSUKI_URL + "?" + queries[qIdx], { headers: UA });
      if (!r || !r.ok) continue;
      var j = await r.json();
      var list = Array.isArray(j) ? j : j && Array.isArray(j.subtitles) ? j.subtitles : [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var subUrl = s && (s.url || s.file);
        if (!subUrl) continue;
        if (isArabicSubText(s.language || s.lang || s.langCode, s.label, s.fileName || s.display)) {
          out.push({
            url: subUrl,
            lang: "ar",
            label: s.label || s.fileName || s.display || "Arabic",
            source: "natsuki",
          });
        }
      }
    } catch (e) {}
  }
  return out;
}

async function fetchArabicSubtitles(target) {
  var results = await Promise.all([
    withTimeout(fetchVdrkArabicSubs(target), 5500),
    withTimeout(fetchNatsukiArabicSubs(target), 5500),
  ]);

  var merged = [];
  var seen = {};
  for (var rIdx = 0; rIdx < results.length; rIdx++) {
    var list = results[rIdx];
    if (!Array.isArray(list)) continue;
    for (var i = 0; i < list.length; i++) {
      var sub = list[i];
      if (!sub || !sub.url || seen[sub.url]) continue;
      seen[sub.url] = 1;
      merged.push({
        url: sub.url,
        lang: "ar",
        label:
          sub.label +
          (merged.length > 0 ? " (" + (merged.length + 1) + ")" : ""),
        source: sub.source || "",
      });
    }
  }
  DIAG.push("ar_subs:" + merged.length);
  return merged;
}

// ---------- Embed discovery & m3u8 extraction ----------
async function fetchPalEmbeds(target) {
  try {
    var qs =
      "title=" +
      encodeURIComponent(target.title) +
      "&type=" +
      encodeURIComponent(target.type);
    if (target.year) qs += "&year=" + encodeURIComponent(target.year);
    if (target.isTv) {
      qs +=
        "&seasonId=" +
        encodeURIComponent(String(target.season)) +
        "&episodeId=" +
        encodeURIComponent(String(target.episode));
    }

    var r = await fetch(PAL_EMBED_URL + "?" + qs, { headers: ATLANTIC_HEADERS });
    if (!r || !r.ok) {
      DIAG.push("pal:" + (r ? r.status : "err"));
      return [];
    }
    var j = await r.json();
    if (!j || !j.found || !Array.isArray(j.embeds)) {
      DIAG.push("pal:empty");
      return [];
    }
    DIAG.push("embeds:" + j.embeds.length);
    return j.embeds;
  } catch (e) {
    DIAG.push("pal:err");
    return [];
  }
}

function extractM3u8Candidates(text, pageUrl) {
  var found = [];
  var seen = {};
  if (!text) return found;

  var clean = String(text).replace(/\\\//g, "/");

  var masterRe = /https?:\/\/[^'"\s\\<>]+master\.m3u8[^'"\s\\<>]*/gi;
  var anyM3u8Re = /https?:\/\/[^'"\s\\<>]+\.m3u8[^'"\s\\<>]*/gi;
  var relM3u8Re = /["']([^"'\s<>]+\.m3u8[^"'\s<>]*)["']/gi;

  var m;
  while ((m = masterRe.exec(clean)) !== null) {
    var u1 = m[0];
    if (!seen[u1]) {
      seen[u1] = 1;
      found.push(u1);
    }
  }
  while ((m = anyM3u8Re.exec(clean)) !== null) {
    var u2 = m[0];
    if (!seen[u2]) {
      seen[u2] = 1;
      found.push(u2);
    }
  }
  while ((m = relM3u8Re.exec(clean)) !== null) {
    var u3 = absUrl(pageUrl, m[1]);
    if (/\.m3u8/i.test(u3) && !seen[u3]) {
      seen[u3] = 1;
      found.push(u3);
    }
  }

  return found;
}

async function extractFromEmbed(embedObj) {
  if (!embedObj || !embedObj.url) return [];
  var embedUrl = String(embedObj.url).trim();
  var embedName = embedObj.name || hostOf(embedUrl);

  try {
    var r = await fetch(embedUrl, {
      headers: Object.assign({}, UA, {
        Referer: BASE + "/",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }),
    });
    if (!r || !r.ok) {
      DIAG.push(embedName + ":http" + (r ? r.status : "0"));
      return [];
    }
    var html = await r.text();
    var m3u8List = extractM3u8Candidates(html, embedUrl);
    if (!m3u8List.length) {
      DIAG.push(embedName + ":no_m3u8");
      return [];
    }
    DIAG.push(embedName + ":ok(" + m3u8List.length + ")");
    return m3u8List.map(function (u) {
      return {
        name: embedName,
        url: u,
        referer: embedUrl,
      };
    });
  } catch (e) {
    DIAG.push(embedName + ":err");
    return [];
  }
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
    var target = await resolveMediaTarget(tmdbId, mediaType, season, episode);
    if (!target) return fail("bad id " + String(tmdbId).slice(0, 24));

    dbg.push(
      target.type +
        " " +
        target.tmdbId +
        (target.isTv ? " S" + target.season + "E" + target.episode : "") +
        " (" +
        target.year +
        ")"
    );

    var subsPromise = fetchArabicSubtitles(target);
    var embeds = await withTimeout(fetchPalEmbeds(target), 7000);
    if (!Array.isArray(embeds) || !embeds.length) {
      return fail("no embeds");
    }

    var sliceEmbeds = embeds.slice(0, MAX_EMBEDS_TO_SCAN);
    var embedResults = await Promise.all(
      sliceEmbeds.map(function (emb) {
        return withTimeout(extractFromEmbed(emb), 6500);
      })
    );

    var rawSources = [];
    for (var eIdx = 0; eIdx < embedResults.length; eIdx++) {
      var list = embedResults[eIdx];
      if (!Array.isArray(list)) continue;
      for (var sIdx = 0; sIdx < list.length; sIdx++) {
        rawSources.push(list[sIdx]);
      }
    }

    var arabicSubs = (await subsPromise) || [];
    if (!rawSources.length) return fail("no m3u8 in embeds");

    var streams = [];
    var seenUrls = {};

    for (var i = 0; i < rawSources.length && streams.length < MAX_STREAMS; i++) {
      var src = rawSources[i];
      var refOrigin = originOf(src.referer || src.url);
      var hdrs = Object.assign({}, UA, {
        Referer: src.referer || BASE + "/",
        Origin: refOrigin,
      });

      var expanded = await withTimeout(expandHls(src.url, hdrs), 5000);
      var variants = Array.isArray(expanded) && expanded.length
        ? expanded
        : [{ url: src.url, quality: "Auto", height: 0 }];

      variants.sort(function (a, b) {
        return (b.height || 0) - (a.height || 0);
      });

      for (var vIdx = 0; vIdx < variants.length && streams.length < MAX_STREAMS; vIdx++) {
        var vItem = variants[vIdx];
        if (!vItem || !vItem.url || seenUrls[vItem.url]) continue;
        seenUrls[vItem.url] = 1;

        streams.push({
          name: "Atlantic " + src.name,
          title: "Atlantic " + src.name + " - " + vItem.quality,
          url: vItem.url,
          quality: vItem.quality,
          headers: hdrs,
          subtitles: arabicSubs,
          provider: "atlantic",
        });
      }
    }

    return streams.length ? streams : fail("no playable streams");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams, DIAG };
