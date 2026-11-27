// Animotvslash (animotvslash.org) SoftSub provider for Nuvio (QuickJS: no DOM, no Node APIs).
// Flow: TMDB/Kitsu -> search animotvslash.org/anime/?s=... -> episode page -> SoftSub mirrors
//       -> extract m3u8 + expand HLS -> Arabic subtitles only

const BASE = "https://animotvslash.org";
const TMDB_API_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

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

// Pure-JS Base64 decoder (works in QuickJS without Buffer or atob)
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeBase64(input) {
  if (!input) return "";
  var clean = String(input).replace(/[^A-Za-z0-9+/=]/g, "");
  var out = "";
  var i = 0;
  while (i < clean.length) {
    var c1 = B64_CHARS.indexOf(clean.charAt(i++));
    var c2 = B64_CHARS.indexOf(clean.charAt(i++));
    var e3 = clean.charAt(i++);
    var e4 = clean.charAt(i++);
    var c3 = e3 === "=" ? 0 : B64_CHARS.indexOf(e3);
    var c4 = e4 === "=" ? 0 : B64_CHARS.indexOf(e4);
    if (c1 < 0 || c2 < 0) break;

    var b1 = (c1 << 2) | (c2 >> 4);
    out += String.fromCharCode(b1);

    if (e3 !== "=" && c3 >= 0) {
      var b2 = ((c2 & 15) << 4) | (c3 >> 2);
      out += String.fromCharCode(b2);
    }
    if (e4 !== "=" && c4 >= 0) {
      var b3 = ((c3 & 3) << 6) | c4;
      out += String.fromCharCode(b3);
    }
  }
  return out;
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

// ---------- SoftSub mirrors extraction ----------
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

function extractStreamsAndArabicSubs(html, mirrorUrl) {
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

  // Also check file/label or track entries for Arabic subtitles
  var trackRe = /(?:file|src|url)["']?\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:vtt|srt)[^"']*)["'][^}]{0,260}?(?:label|lang|language)["']?\s*[:=]\s*["']([^"']+)["']/gi;
  var tm;
  while ((tm = trackRe.exec(clean)) !== null) {
    var tUrl = decodeHtmlEntities(tm[1]);
    var tLabel = decodeHtmlEntities(tm[2]);
    if (isArabicSub("", tLabel, tUrl) && !seenSub[tUrl]) {
      seenSub[tUrl] = 1;
      arabicSubs.push({
        url: tUrl,
        lang: "ar",
        label: tLabel || "Arabic",
      });
    }
  }

  return { streams: streams, arabicSubs: arabicSubs, referer: mirrorUrl };
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
    var mirrorPages = await Promise.all(
      scanList.map(function (m) {
        return withTimeout(
          fetch(m.url, {
            headers: Object.assign({}, UA, {
              Referer: epPageUrl,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            }),
          }).then(function (r) {
            return r && r.ok ? r.text() : "";
          }),
          6000
        );
      })
    );

    var collectedStreams = [];
    var collectedArSubs = [];
    var seenSubUrl = {};

    for (var i = 0; i < scanList.length; i++) {
      var mObj = scanList[i];
      var mHtml = mirrorPages[i] || "";
      if (!mHtml) {
        DIAG.push(mObj.label + ":empty");
        continue;
      }

      var parsed = extractStreamsAndArabicSubs(mHtml, mObj.url);
      if (parsed.streams.length) {
        DIAG.push(mObj.label + ":ok(" + parsed.streams.length + ")");
        for (var sIdx = 0; sIdx < parsed.streams.length; sIdx++) {
          collectedStreams.push({
            label: mObj.label,
            url: parsed.streams[sIdx],
            referer: mObj.url,
          });
        }
      } else {
        DIAG.push(mObj.label + ":no_m3u8");
      }

      for (var subIdx = 0; subIdx < parsed.arabicSubs.length; subIdx++) {
        var subItem = parsed.arabicSubs[subIdx];
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
