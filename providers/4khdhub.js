// 4KHDHub Scraper for Nuvio Local Scrapers (hardened version)
// - Fixed domain (edit BASE_URL by hand when the site moves; no remote domains list)
// - Allowlist of hosts the scraper may talk to (see ALLOWED_HOSTS / STRICT)
// - https-only links, request timeout, response.ok check, de-duplication
// React Native compatible version

"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// ---------- constants ----------
// Change this by hand if the site changes its domain, then bump the version in manifest.json.
var BASE_URL = "https://4khdhub.one";
// Replace with your own TMDB key (https://www.themoviedb.org/settings/api).
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
var FETCH_TIMEOUT = 12000;

// Hosts the scraper is allowed to contact (BASE_URL's host is always allowed).
var ALLOWED_HOSTS = [
  /(^|\.)4khdhub\.[a-z]+$/i,
  /(^|\.)hubcloud\.[a-z]+$/i,
  /(^|\.)hubdrive\.[a-z]+$/i,
  /(^|\.)hubcdn\.[a-z]+$/i,
  /(^|\.)pixeldrain\.[a-z]+$/i,
  /^api\.themoviedb\.org$/i
];
// false: hosts not in the list are only LOGGED ("Unlisted host: ...") so you can see which ones
//        the site really uses and add them above.
// true : hosts not in the list are BLOCKED (requests and returned stream links).
// Run once with false, add the legitimate hosts from the log, then switch to true.
var STRICT = false;

// ---------- url safety ----------
function hostOfUrl(u) {
  var m = /^https:\/\/([^\/?#:]+)/i.exec(String(u || ""));
  return m ? m[1].toLowerCase() : "";
}
var BASE_HOST = hostOfUrl(BASE_URL);

function isListedHost(host) {
  if (host === BASE_HOST) return true;
  for (var i = 0; i < ALLOWED_HOSTS.length; i++) {
    if (ALLOWED_HOSTS[i].test(host)) return true;
  }
  return false;
}

// https only; allowlist enforced when STRICT is true.
function checkUrl(url) {
  var host = hostOfUrl(url);
  if (!host) {
    console.log("[4KHDHub] Skipped non-https or invalid URL");
    return false;
  }
  if (isListedHost(host)) return true;
  console.log("[4KHDHub] Unlisted host: " + host + (STRICT ? " (blocked)" : ""));
  return !STRICT;
}

function absolutize(base, rel) {
  if (!rel) return "";
  rel = String(rel).trim();
  if (/^https?:\/\//i.test(rel)) return rel;
  if (rel.indexOf("//") === 0) return "https:" + rel;
  var m = /^(https?:\/\/[^\/?#]+)/i.exec(String(base || ""));
  if (!m) return "";
  if (rel.charAt(0) === "/") return m[1] + rel;
  return "";
}

// ---------- http ----------
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    if (!checkUrl(url)) return null;
    var controller = null;
    var tid = null;
    try {
      if (typeof AbortController !== "undefined" && typeof setTimeout === "function") {
        controller = new AbortController();
        tid = setTimeout(function() { controller.abort(); }, FETCH_TIMEOUT);
      }
    } catch (e) {
      controller = null;
    }
    try {
      const init = {
        headers: __spreadValues({
          "User-Agent": USER_AGENT
        }, options.headers)
      };
      if (controller) init.signal = controller.signal;
      const response = yield fetch(url, init);
      if (tid) clearTimeout(tid);
      if (!response.ok) {
        console.log(`[4KHDHub] HTTP ${response.status} from ${hostOfUrl(url)}`);
        return null;
      }
      return yield response.text();
    } catch (err) {
      if (tid) clearTimeout(tid);
      console.log(`[4KHDHub] Request failed for ${hostOfUrl(url)}: ${err.message}`);
      return null;
    }
  });
}

// ---------- tmdb ----------
function getTmdbDetails(tmdbId, type) {
  return __async(this, null, function* () {
    const isSeries = type === "series" || type === "tv";
    const endpoint = isSeries ? "tv" : "movie";
    const url = `https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(tmdbId)}?api_key=${TMDB_API_KEY}`;
    console.log(`[4KHDHub] Fetching TMDB details for ${endpoint}/${tmdbId}`); // key is not logged
    try {
      const text = yield fetchText(url);
      if (!text) return null;
      const data = JSON.parse(text);
      if (isSeries) {
        return {
          title: data.name,
          year: data.first_air_date ? parseInt(data.first_air_date.split("-")[0]) : 0
        };
      } else {
        return {
          title: data.title,
          year: data.release_date ? parseInt(data.release_date.split("-")[0]) : 0
        };
      }
    } catch (error) {
      console.log(`[4KHDHub] TMDB request failed: ${error.message}`);
      return null;
    }
  });
}

// ---------- utils ----------
function atob(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = String(input).replace(/=+$/, "");
  if (str.length % 4 === 1) {
    throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
  }
  let output = "";
  for (let bc = 0, bs, buffer, i = 0; buffer = str.charAt(i++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = chars.indexOf(buffer);
  }
  return output;
}
function rot13Cipher(str) {
  return str.replace(/[a-zA-Z]/g, function(c) {
    return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
  });
}
function levenshteinDistance(s, t) {
  if (s === t)
    return 0;
  const n = s.length;
  const m = t.length;
  if (n === 0)
    return m;
  if (m === 0)
    return n;
  const d = [];
  for (let i = 0; i <= n; i++) {
    d[i] = [];
    d[i][0] = i;
  }
  for (let j = 0; j <= m; j++) {
    d[0][j] = j;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[n][m];
}
function parseBytes(val) {
  if (typeof val === "number")
    return val;
  if (!val)
    return 0;
  const match = val.match(/^([0-9.]+)\s*([a-zA-Z]+)$/);
  if (!match)
    return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let multiplier = 1;
  if (unit.indexOf("k") === 0)
    multiplier = 1024;
  else if (unit.indexOf("m") === 0)
    multiplier = 1024 * 1024;
  else if (unit.indexOf("g") === 0)
    multiplier = 1024 * 1024 * 1024;
  else if (unit.indexOf("t") === 0)
    multiplier = 1024 * 1024 * 1024 * 1024;
  return num * multiplier;
}
function formatBytes(val) {
  if (val === 0)
    return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  let i = Math.floor(Math.log(val) / Math.log(k));
  if (i < 0)
    i = 0;
  return parseFloat((val / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ---------- search ----------
var cheerio = require("cheerio-without-node-native");
function fetchPageUrl(name, year, isSeries) {
  return __async(this, null, function* () {
    const domain = BASE_URL;
    const searchQuery = name + (year ? " " + year : "");
    const searchUrl = `${domain}/?s=${encodeURIComponent(searchQuery)}`;
    console.log(`[4KHDHub] Searching: ${searchQuery}`);
    const html = yield fetchText(searchUrl);
    if (!html) {
      console.log("[4KHDHub] Search failed: No HTML response");
      return null;
    }
    const $ = cheerio.load(html);
    const targetType = isSeries ? "Series" : "Movies";
    console.log(`[4KHDHub] Parsing search results for type: ${targetType}`);
    const candidates = $("a.movie-card").map((_, el) => {
      const cardText = $(el).text();
      const cardTitle = $(el).find("h3").text().trim() || ($(el).attr("aria-label") || "").replace(/\s+details$/i, "").trim();
      const yearText = $(el).find("p").text().trim();
      const movieCardYear = parseInt((yearText.match(/(\d{4})/) || [0])[0], 10) || 0;
      const isSeriesCard = /\bSeries\b/i.test(cardText);
      if (isSeries && !isSeriesCard) return null;
      if (!isSeries && isSeriesCard) return null;
      const yearDistance = movieCardYear === 0 || !year ? 0 : Math.abs(movieCardYear - year);
      if (movieCardYear !== 0 && year && yearDistance > 1) {
        console.log(`[4KHDHub] Skip: Year mismatch (${movieCardYear} vs ${year}) - ${cardTitle}`);
        return null;
      }
      const cleanedTitle = cardTitle.replace(/\[.*?]/g, "").trim();
      const distance = levenshteinDistance(cleanedTitle.toLowerCase(), name.toLowerCase());
      const titleMatch = cleanedTitle.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(cleanedTitle.toLowerCase()) || distance < 6;
      console.log(`[4KHDHub] Checking: "${cleanedTitle}" (Dist: ${distance}) vs "${name}"`);
      if (!titleMatch) return null;
      let href = $(el).attr("href");
      if (href && !href.startsWith("http")) {
        href = domain + (href.startsWith("/") ? "" : "/") + href;
      }
      return { href, distance, yearDistance, title: cleanedTitle };
    }).get().filter((candidate) => candidate && candidate.href);
    if (candidates.length === 0) {
      console.log("[4KHDHub] No matching cards found after filtering");
      return null;
    }
    const matchingCards = candidates.sort((a, b) => a.distance - b.distance || a.yearDistance - b.yearDistance);
    console.log(`[4KHDHub] Found ${matchingCards.length} matching cards, best match: ${matchingCards[0].title}`);
    return matchingCards[0].href;
  });
}

// ---------- extractor ----------
var cheerio2 = require("cheerio-without-node-native");
function resolveRedirectUrl(redirectUrl) {
  return __async(this, null, function* () {
    if (!redirectUrl) {
      console.log("[4KHDHub] No redirect URL provided");
      return null;
    }

    const redirectHtml = yield fetchText(redirectUrl);
    if (!redirectHtml) {
      console.log("[4KHDHub] Failed to fetch redirect HTML");
      return redirectUrl;
    }

    try {
      const patterns = [
        /'o','(.*?)'/,
        /['"]o['"],\s*['"]([^'"]+)['"]/,
        /'o'\s*:\s*'([^']+)'/,
        /window\.atob\(['"]([^'"]+)['"]\)/,
        /var\s+o\s*=\s*['"]([^'"]+)['"]/
      ];

      let redirectDataMatch = null;
      for (const pattern of patterns) {
        redirectDataMatch = redirectHtml.match(pattern);
        if (redirectDataMatch) {
          console.log(`[4KHDHub] Matched pattern: ${pattern}`);
          break;
        }
      }

      if (!redirectDataMatch || !redirectDataMatch[1]) {
        console.log("[4KHDHub] No redirect data pattern matched, trying direct URL extraction");
        const scriptMatch = redirectHtml.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (scriptMatch && scriptMatch[1]) {
          return absolutize(redirectUrl, scriptMatch[1]) || redirectUrl;
        }
        return redirectUrl;
      }

      const step1 = atob(redirectDataMatch[1]);
      const step2 = atob(step1);
      const step3 = rot13Cipher(step2);
      const step4 = atob(step3);
      const redirectData = JSON.parse(step4);

      if (redirectData && redirectData.o) {
        const finalUrl = atob(redirectData.o);
        console.log(`[4KHDHub] Successfully resolved redirect URL`);
        return finalUrl;
      }

      console.log("[4KHDHub] No 'o' property in redirect data");
      return redirectUrl;
    } catch (e) {
      console.log(`[4KHDHub] Error resolving redirect: ${e.message}`);
      return redirectUrl;
    }
  });
}
function extractSourceResults($, el) {
  return __async(this, null, function* () {
    const localHtml = $(el).html();
    if (!localHtml) {
      console.log("[4KHDHub] Warning: No HTML found for element");
      return null;
    }

    const sizeMatch = localHtml.match(/([\d.]+ ?[GM]B)/);
    const heightMatch = localHtml.match(/\d{3,}p/);
    const title = $(el).find(".file-title, .episode-file-title, .file-name, span").text().trim();

    let height = heightMatch ? parseInt(heightMatch[0]) : 0;
    if (height === 0 && (title.includes("4K") || title.includes("4k") || localHtml.includes("4K") || localHtml.includes("4k"))) {
      height = 2160;
    }

    const meta = {
      bytes: sizeMatch ? parseBytes(sizeMatch[1]) : 0,
      height,
      title: title || "Download"
    };

    let hubCloudLink = $(el).find("a").filter((_, a) => {
      const text = $(a).text();
      return text.includes("HubCloud") || text.includes("hubcloud");
    }).attr("href");

    if (hubCloudLink) {
      console.log(`[4KHDHub] Found HubCloud link`);
      const resolved = yield resolveRedirectUrl(hubCloudLink);
      if (resolved) {
        return { url: resolved, meta };
      }
    }

    let hubDriveLink = $(el).find("a").filter((_, a) => {
      const text = $(a).text();
      return text.includes("HubDrive") || text.includes("hubdrive");
    }).attr("href");

    if (hubDriveLink) {
      console.log(`[4KHDHub] Found HubDrive link`);
      const resolvedDrive = yield resolveRedirectUrl(hubDriveLink);
      const driveUrl = resolvedDrive || hubDriveLink;
      if (driveUrl) {
        const hubDriveHtml = yield fetchText(driveUrl);
        if (hubDriveHtml) {
          const $2 = cheerio2.load(hubDriveHtml);
          const innerCloudLink = $2('a').filter((_, a) => {
            const href = $2(a).attr("href") || "";
            const text = $2(a).text().toLowerCase();
            return text.includes("hubcloud") || href.includes("hubcloud");
          }).attr("href");
          if (innerCloudLink) {
            return { url: absolutize(driveUrl, innerCloudLink), meta };
          }
          const anySupportedLink = $2('a[href]').filter((_, a) => {
            const href = $2(a).attr("href") || "";
            return href.includes("hubcloud") || href.includes("hubdrive") || href.includes("pixeldrain") || href.includes("drive.google.com");
          }).attr("href");
          if (anySupportedLink) {
            return { url: absolutize(driveUrl, anySupportedLink), meta };
          }
        }
        return { url: driveUrl, meta };
      }
    }

    const fallbackLink = $(el).find("a[href]").filter((_, a) => {
      const href = $(a).attr("href");
      return href && (href.includes("hubcloud") || href.includes("hubdrive") || href.includes("pixeldrain"));
    }).attr("href");

    if (fallbackLink) {
      console.log(`[4KHDHub] Using fallback link`);
      return { url: fallbackLink, meta };
    }

    console.log("[4KHDHub] No viable links found in element");
    return null;
  });
}
function extractHubCloud(hubCloudUrl, baseMeta) {
  return __async(this, null, function* () {
    if (!hubCloudUrl) {
      console.log("[4KHDHub] No HubCloud URL provided");
      return [];
    }

    console.log(`[4KHDHub] Extracting from HubCloud host: ${hostOfUrl(hubCloudUrl)}`);

    const redirectHtml = yield fetchText(hubCloudUrl, { headers: { Referer: hubCloudUrl } });
    if (!redirectHtml) {
      console.log("[4KHDHub] Failed to fetch HubCloud page");
      return [];
    }

    const urlPatterns = [
      /var\s+url\s*=\s*'([^']+)'/,
      /var\s+url\s*=\s*"([^"]+)"/,
      /'url'\s*:\s*'([^']+)'/,
      /window\.location\.href\s*=\s*'([^']+)'/,
      /<iframe[^>]+src=['"]([^'"]+)['"]/
    ];

    let finalLinksUrl = null;
    for (const pattern of urlPatterns) {
      const match = redirectHtml.match(pattern);
      if (match && match[1]) {
        finalLinksUrl = absolutize(hubCloudUrl, match[1]);
        console.log(`[4KHDHub] Found URL with pattern: ${pattern}`);
        break;
      }
    }

    if (!finalLinksUrl) {
      console.log("[4KHDHub] Could not find final links URL");
      return [];
    }

    const linksHtml = yield fetchText(finalLinksUrl, { headers: { Referer: hubCloudUrl } });
    if (!linksHtml) {
      console.log("[4KHDHub] Failed to fetch final links page");
      return [];
    }

    const $ = cheerio2.load(linksHtml);
    const results = [];

    const sizeText = $("#size, #file-size, span[id*='size']").text();
    const titleText = $("title").text().trim();

    const currentMeta = __spreadProps(__spreadValues({}, baseMeta), {
      bytes: parseBytes(sizeText) || baseMeta.bytes,
      title: titleText || baseMeta.title
    });

    $("a").each((_, el) => {
      const text = $(el).text().trim();
      const rawHref = $(el).attr("href");

      if (!rawHref) return;
      const href = absolutize(finalLinksUrl, rawHref);
      if (!href || !checkUrl(href)) return; // https only (+ allowlist when STRICT)

      const lower = text.toLowerCase();

      // PixelDrain must be tested first: its button text can also contain "download".
      if (text.includes("PixelServer") || lower.includes("pixeldrain") || href.includes("pixeldrain")) {
        results.push({
          source: "PixelServer",
          url: href.replace("/u/", "/api/file/"),
          meta: currentMeta
        });
      } else if (text.includes("FSL") || text.includes("Download File") || lower.includes("download")) {
        results.push({
          source: "FSL",
          url: href,
          meta: currentMeta
        });
      } else if (lower.includes("link") || href.includes("cdn") || href.includes("stream")) {
        results.push({
          source: "Direct",
          url: href,
          meta: currentMeta
        });
      }
    });

    return results;
  });
}

// ---------- entry point ----------
var cheerio3 = require("cheerio-without-node-native");
function getStreams(tmdbId, type, season, episode) {
  return __async(this, null, function* () {
    try {
      console.log(`[4KHDHub] Starting extraction for TMDB ID: ${tmdbId}, Type: ${type}, Season: ${season}, Episode: ${episode}`);

      const tmdbDetails = yield getTmdbDetails(tmdbId, type);
      if (!tmdbDetails) {
        console.log("[4KHDHub] Failed to get TMDB details");
        return [];
      }

      const { title, year } = tmdbDetails;
      console.log(`[4KHDHub] Search: ${title} (${year})`);

      const isSeries = type === "series" || type === "tv";
      const pageUrl = yield fetchPageUrl(title, year, isSeries);
      if (!pageUrl) {
        console.log("[4KHDHub] Page not found");
        return [];
      }

      console.log(`[4KHDHub] Found page: ${pageUrl}`);

      const html = yield fetchText(pageUrl);
      if (!html) {
        console.log("[4KHDHub] Failed to fetch page HTML");
        return [];
      }

      const $ = cheerio3.load(html);
      const itemsToProcess = [];

      if (isSeries && season && episode) {
        const seasonStr = "S" + String(season).padStart(2, "0");
        const episodePadded = String(episode).padStart(2, "0");
        const episodeCode = `S${seasonStr.slice(1)}E${episodePadded}`;

        // Matches "S1", "S01" and "Season 1" in the season header.
        const seasonPattern = new RegExp(`\\b(?:S0?${season}|Season[-_ ]?0?${season})\\b`, "i");
        const episodePattern = new RegExp(`(?:${episodeCode}|Episode[-_ ]?${episodePadded}|\\bE${episodePadded}\\b)`, "i");
        // Strict pattern for the fallback, so an episode of another season is never picked.
        const strictEpisodePattern = new RegExp(`S0?${season}[ ._-]?E0?${episode}\\b`, "i");

        console.log(`[4KHDHub] Looking for season ${seasonStr}, episode ${episodePadded}`);

        $(".season-item.episode-item, .episode-item").each((_, el) => {
          const headerText = $(el).find(".episode-title, .episode-info, .episode-header, .episode-number").text();
          if (!seasonPattern.test(headerText)) {
            return;
          }
          const downloadItems = $(el).find(".episode-download-item").filter((_2, item) => {
            const titleText = $(item).find(".episode-file-title, .file-title, .episode-title").text() || $(item).text();
            return episodePattern.test(titleText);
          });
          downloadItems.each((_2, item) => {
            itemsToProcess.push(item);
          });
        });

        if (itemsToProcess.length === 0) {
          const fallbackItems = $(".episode-download-item").filter((_2, item) => {
            const titleText = $(item).find(".episode-file-title, .file-title, .episode-title").text() || $(item).text();
            return strictEpisodePattern.test(titleText);
          });
          fallbackItems.each((_2, item) => {
            itemsToProcess.push(item);
          });
        }
      } else {
        console.log("[4KHDHub] Looking for movie download items");
        const found = [];
        $(".download-item, .file-item, .movie-file, [class*='download'], [class*='file']").each((_, el) => {
          const hasLink = $(el).find("a[href]").length > 0;
          if (hasLink) {
            found.push(el);
          }
        });
        // Keep only the innermost matches so nested containers are not processed twice.
        found.forEach((el) => {
          let hasInner = false;
          try {
            hasInner = found.some((o) => o !== el && $.contains(el, o));
          } catch (e) {}
          if (!hasInner && itemsToProcess.indexOf(el) === -1) itemsToProcess.push(el);
        });
      }

      console.log(`[4KHDHub] Processing ${itemsToProcess.length} items`);

      if (itemsToProcess.length === 0) {
        console.log("[4KHDHub] No download items found on page");
        return [];
      }

      const streamPromises = itemsToProcess.map((item) => __async(this, null, function* () {
        try {
          const sourceResult = yield extractSourceResults($, item);
          if (sourceResult && sourceResult.url) {
            const extractedLinks = yield extractHubCloud(sourceResult.url, sourceResult.meta);

            return extractedLinks.map((link) => {
              const size = link.meta.bytes ? formatBytes(link.meta.bytes) : undefined;

              return {
                name: `4KHDHub - ${link.source}${sourceResult.meta.height ? ` ${sourceResult.meta.height}p` : ""}`,
                title: link.meta.title,
                url: link.url,
                quality: sourceResult.meta.height ? `${sourceResult.meta.height}p` : undefined,
                size: size,
                behaviorHints: {
                  bingeGroup: `4khdhub-${link.source}`
                }
              };
            });
          }
          return [];
        } catch (err) {
          console.log(`[4KHDHub] Item processing error: ${err.message}`);
          return [];
        }
      }));

      const results = yield Promise.all(streamPromises);
      const flattened = results.reduce((acc, val) => acc.concat(val), []);

      // Final safety net: https only (+ allowlist when STRICT), no duplicate links.
      const seen = {};
      const unique = flattened.filter((s) => {
        if (!s || !s.url || seen[s.url]) return false;
        if (!checkUrl(s.url)) return false;
        seen[s.url] = true;
        return true;
      });
      console.log(`[4KHDHub] Found ${unique.length} total streams`);
      return unique;
    } catch (err) {
      console.log(`[4KHDHub] Fatal error: ${err.message}`);
      return [];
    }
  });
}

module.exports = { getStreams };
