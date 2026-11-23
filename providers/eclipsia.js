const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY =
  (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) ||
  "307b7b8ef035c6aa336900aef4e203bd";

function cleanTmdbId(rawId) {
  const s = String(rawId || "").trim();
  const cleaned = s.replace(/^(tmdb[:_-]?|tt)/i, "").trim();
  return /^\d+$/.test(cleaned) ? cleaned : null;
}

function normalizeInput(id, mediaType, season, episode) {
  const tmdbId = cleanTmdbId(id);
  if (!tmdbId) return null;
  const type = mediaType === "movie" ? "movie" : "tv";
  const sNum = Number(season) > 0 ? Number(season) : 1;
  const eNum =
    type === "movie" ? 1 : Number(episode) > 0 ? Number(episode) : 1;
  return {
    tmdbId: tmdbId,
    mediaType: type,
    season: sNum,
    episode: eNum,
  };
}

function safeJson(url, headers) {
  return Promise.resolve()
    .then(function () {
      return fetch(url, { headers: headers || {} });
    })
    .then(function (res) {
      return res && res.ok ? res.json() : null;
    })
    .catch(function () {
      return null;
    });
}

function safeText(url, headers) {
  return Promise.resolve()
    .then(function () {
      return fetch(url, { headers: headers || {} });
    })
    .then(function (res) {
      return res && res.ok ? res.text() : null;
    })
    .catch(function () {
      return null;
    });
}

function dedupeByUrl(list) {
  const seen = Object.create(null);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || !item.url || seen[item.url]) continue;
    seen[item.url] = true;
    out.push(item);
  }
  return out;
}

/* =========================================================================
 * 1) AniKage Source
 * ========================================================================= */
function fetchAniKageStreams(q) {
  const BASE_URL = "https://anikage.cc";
  const API_BASE = "https://anikage.cc/api/media/anime";
  const BKY_BASE = "https://og.bakayaro.live";
  const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
  const SOURCES = ["koto", "kiwi", "wave"];
  const LANGS = ["sub", "dub"];
  const J_HEADERS = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Referer: BASE_URL + "/",
    Origin: BASE_URL,
  };
  const S_HEADERS = {
    "User-Agent": USER_AGENT,
    Referer: BASE_URL + "/",
    Origin: BASE_URL,
  };

  function pickTitle(t) {
    t = t || {};
    return String(t.english || t.romaji || t.native || "").trim();
  }

  function getDetails() {
    const endpoint = q.mediaType === "movie" ? "movie" : "tv";
    return Promise.all([
      safeJson(
        TMDB_API_BASE +
          "/" +
          endpoint +
          "/" +
          q.tmdbId +
          "?api_key=" +
          TMDB_KEY,
        { Accept: "application/json" }
      ),
      q.mediaType === "tv"
        ? safeJson(
            TMDB_API_BASE +
              "/tv/" +
              q.tmdbId +
              "/season/" +
              q.season +
              "?api_key=" +
              TMDB_KEY,
            { Accept: "application/json" }
          )
        : Promise.resolve(null),
    ]).then(function (replies) {
      const showData = replies[0];
      const seasonData = replies[1];
      if (!showData) return null;
      const title =
        q.mediaType === "tv" ? showData.name || "" : showData.title || "";
      const seasonName =
        seasonData &&
        seasonData.name &&
        seasonData.name.toLowerCase() !== "season " + q.season
          ? seasonData.name.trim()
          : null;
      return { title: title, seasonName: seasonName };
    });
  }

  function searchSlug(query) {
    return safeJson(
      API_BASE + "/search?q=" + encodeURIComponent(query) + "&limit=5",
      J_HEADERS
    ).then(function (data) {
      const results = (data && data.data) || [];
      if (!results.length) return null;
      const ql = String(query || "").toLowerCase();
      for (let i = 0; i < results.length; i++) {
        if (pickTitle(results[i].title).toLowerCase() === ql) {
          return results[i].slug;
        }
      }
      return results[0].slug || null;
    });
  }

  function findSlug(title, seasonName) {
    const queries = [];
    if (seasonName) queries.push(seasonName);
    if (q.season > 1) queries.push(title + " Season " + q.season);
    queries.push(title);

    return Promise.all(queries.map(searchSlug)).then(function (slugs) {
      for (let i = 0; i < slugs.length; i++) {
        if (slugs[i]) return slugs[i];
      }
      return null;
    });
  }

  function toSubtitles(list) {
    const out = [];
    for (let i = 0; i < (list || []).length; i++) {
      const sub = list[i];
      if (!sub || !sub.file) continue;
      out.push({
        url: BKY_BASE + "/stream/" + sub.file,
        language: sub.label || "Subtitle",
        headers: S_HEADERS,
      });
    }
    return out;
  }

  function fetchProviderLang(slug, provider, lang) {
    const url =
      API_BASE +
      "/" +
      encodeURIComponent(slug) +
      "/episodes/" +
      encodeURIComponent(String(q.episode)) +
      "/sources?lang=" +
      encodeURIComponent(lang) +
      "&provider=" +
      encodeURIComponent(provider);

    return safeJson(url, J_HEADERS).then(function (data) {
      if (!data) return [];
      const subtitles = toSubtitles(data.subtitles || []);
      const langLabel = lang === "dub" ? "English" : "Japanese";
      const providerLabel =
        provider.charAt(0).toUpperCase() + provider.slice(1);
      const label = "AniKage • " + providerLabel + " • " + langLabel;
      const sources = data.sources || [];
      const out = [];

      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        if (!s || !s.url) continue;
        const isHls = s.isM3U8 !== false;
        out.push({
          name: label,
          title: label,
          url: BKY_BASE + (isHls ? "/m3u8/" : "/stream/") + s.url,
          quality: "1080p",
          headers: S_HEADERS,
          subtitles: subtitles,
        });
      }
      return out;
    });
  }

  return getDetails()
    .then(function (details) {
      if (!details || !details.title) return [];
      return findSlug(details.title, details.seasonName).then(function (slug) {
        if (!slug) return [];
        const jobs = [];
        for (let i = 0; i < SOURCES.length; i++) {
          for (let j = 0; j < LANGS.length; j++) {
            jobs.push(fetchProviderLang(slug, SOURCES[i], LANGS[j]));
          }
        }
        return Promise.all(jobs).then(function (groups) {
          let flat = [];
          for (let g = 0; g < groups.length; g++) {
            flat = flat.concat(groups[g] || []);
          }
          return dedupeByUrl(flat);
        });
      });
    })
    .catch(function () {
      return [];
    });
}

/* =========================================================================
 * 2) Anikoto Source
 * ========================================================================= */
function fetchAnikotoStreams(q) {
  const BASE_URL = "https://anikoto.cz";
  const HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    Referer: BASE_URL + "/",
  };
  const AJAX_HEADERS = Object.assign({}, HEADERS, {
    "X-Requested-With": "XMLHttpRequest",
  });
  const B64 =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const SBOX = [];
  const INV_SBOX = [];
  const FOLD = [
    ["a", "àáâãäåāăą"],
    ["c", "çćĉċč"],
    ["d", "ď"],
    ["e", "èéêëēĕėęě"],
    ["g", "ĝğġģ"],
    ["h", "ĥ"],
    ["i", "ìíîïĩīĭį"],
    ["j", "ĵ"],
    ["k", "ķ"],
    ["l", "ĺļľ"],
    ["n", "ñńņň"],
    ["o", "òóôõöōŏő"],
    ["r", "ŕŗř"],
    ["s", "śŝşš"],
    ["t", "ţť"],
    ["u", "ùúûüũūŭůűų"],
    ["w", "ŵ"],
    ["y", "ýÿŷ"],
    ["z", "źżž"],
  ];
  const FOLDED = Object.create(null);

  for (let i = 0; i < FOLD.length; i++) {
    const chars = FOLD[i][1];
    for (let j = 0; j < chars.length; j++) {
      FOLDED[chars.charAt(j)] = FOLD[i][0];
    }
  }

  (function buildSboxes() {
    let p = 1;
    let qv = 1;
    function rotl(value, n) {
      return ((value << n) | (value >> (8 - n))) & 255;
    }
    do {
      p = (p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0)) & 255;
      qv ^= qv << 1;
      qv ^= qv << 2;
      qv ^= qv << 4;
      qv &= 255;
      if (qv & 0x80) qv ^= 0x09;
      const x = qv ^ rotl(qv, 1) ^ rotl(qv, 2) ^ rotl(qv, 3) ^ rotl(qv, 4);
      SBOX[p] = (x ^ 0x63) & 255;
    } while (p !== 1);
    SBOX[0] = 0x63;
    for (let k = 0; k < 256; k++) INV_SBOX[SBOX[k]] = k;
  })();

  function gmul(a, b) {
    let result = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) result ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 255;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return result;
  }

  function utf8Bytes(str) {
    const out = [];
    const text = String(str);
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next < 0xe000) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000)
        out.push(
          0xe0 | (code >> 12),
          0x80 | ((code >> 6) & 63),
          0x80 | (code & 63)
        );
      else
        out.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 63),
          0x80 | ((code >> 6) & 63),
          0x80 | (code & 63)
        );
    }
    return out;
  }

  function utf8Decode(bytes) {
    let escaped = "";
    for (let i = 0; i < bytes.length; i++) {
      const hex = bytes[i].toString(16);
      escaped += "%" + (hex.length < 2 ? "0" + hex : hex);
    }
    return decodeURIComponent(escaped);
  }

  function padBytes(str, length) {
    const bytes = utf8Bytes(str);
    const out = [];
    for (let i = 0; i < length; i++) {
      out.push(i < bytes.length ? bytes[i] : 0);
    }
    return out;
  }

  function base64ToBytes(str) {
    const text = String(str).replace(/[^A-Za-z0-9+/]/g, "");
    const out = [];
    let bits = 0;
    let acc = 0;
    for (let i = 0; i < text.length; i++) {
      acc = (acc << 6) | B64.indexOf(text.charAt(i));
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 255);
        acc &= (1 << bits) - 1;
      }
    }
    return out;
  }

  function expandKey(key) {
    const words = [];
    const rounds = [];
    let rcon = 1;
    for (let i = 0; i < 8; i++) words.push(key.slice(i * 4, i * 4 + 4));
    for (let i = 8; i < 60; i++) {
      let temp = words[i - 1].slice();
      if (i % 8 === 0) {
        temp = [
          SBOX[temp[1]] ^ rcon,
          SBOX[temp[2]],
          SBOX[temp[3]],
          SBOX[temp[0]],
        ];
        rcon = gmul(rcon, 2);
      } else if (i % 8 === 4) {
        temp = temp.map(function (b) {
          return SBOX[b];
        });
      }
      const prior = words[i - 8];
      words.push(
        prior.map(function (b, j) {
          return b ^ temp[j];
        })
      );
    }
    for (let r = 0; r < 15; r++) {
      rounds.push(
        [].concat(
          words[r * 4],
          words[r * 4 + 1],
          words[r * 4 + 2],
          words[r * 4 + 3]
        )
      );
    }
    return rounds;
  }

  function decryptBlock(block, rounds) {
    const s = block.slice();
    for (let i = 0; i < 16; i++) s[i] ^= rounds[14][i];
    for (let r = 13; r >= 0; r--) {
      const t = s.slice();
      for (let c = 0; c < 4; c++) {
        for (let row = 0; row < 4; row++) {
          s[((c + row) % 4) * 4 + row] = t[c * 4 + row];
        }
      }
      for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
      for (let i = 0; i < 16; i++) s[i] ^= rounds[r][i];
      if (r > 0) {
        for (let c = 0; c < 4; c++) {
          const a = s.slice(c * 4, c * 4 + 4);
          s[c * 4] =
            gmul(a[0], 14) ^ gmul(a[1], 11) ^ gmul(a[2], 13) ^ gmul(a[3], 9);
          s[c * 4 + 1] =
            gmul(a[0], 9) ^ gmul(a[1], 14) ^ gmul(a[2], 11) ^ gmul(a[3], 13);
          s[c * 4 + 2] =
            gmul(a[0], 13) ^ gmul(a[1], 9) ^ gmul(a[2], 14) ^ gmul(a[3], 11);
          s[c * 4 + 3] =
            gmul(a[0], 11) ^ gmul(a[1], 13) ^ gmul(a[2], 9) ^ gmul(a[3], 14);
        }
      }
    }
    return s;
  }

  function decryptAesCbc(encryptedBase64) {
    try {
      const rounds = expandKey(padBytes("i?LMTAx0Q6,:}50U", 32));
      const data = base64ToBytes(
        String(encryptedBase64).replace(/-/g, "+").replace(/_/g, "/")
      );
      const out = [];
      let prev = padBytes("W0;27ToaUpl_P%'c", 16);
      for (let offset = 0; offset + 16 <= data.length; offset += 16) {
        const block = data.slice(offset, offset + 16);
        const plain = decryptBlock(block, rounds);
        for (let i = 0; i < 16; i++) out.push(plain[i] ^ prev[i]);
        prev = block;
      }
      const pad = out[out.length - 1];
      return JSON.parse(utf8Decode(out.slice(0, out.length - pad)));
    } catch (_) {
      return null;
    }
  }

  function decodeHtmlEntities(str) {
    if (!str) return "";
    return String(str)
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function normalizeTitle(str) {
    if (!str) return "";
    return String(str)
      .replace(/[à-ž]/g, function (c) {
        return FOLDED[c] || c;
      })
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function allMatches(text, re) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push(m);
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }

  function originOf(url) {
    const m = /^(https?:\/\/[^\/?#]+)/i.exec(url);
    return m ? m[1].toLowerCase() : null;
  }

  function queryParam(url, key) {
    const qi = url.indexOf("?");
    if (qi < 0) return null;
    const hash = url.indexOf("#", qi);
    const pairs = url.slice(qi + 1, hash < 0 ? url.length : hash).split("&");
    for (let i = 0; i < pairs.length; i++) {
      const kv = pairs[i].split("=");
      try {
        if (decodeURIComponent(kv[0].replace(/\+/g, " ")) === key) {
          return decodeURIComponent(kv.slice(1).join("=").replace(/\+/g, " "));
        }
      } catch (_) {}
    }
    return null;
  }

  function getMeta() {
    const url =
      TMDB_API_BASE +
      "/" +
      q.mediaType +
      "/" +
      q.tmdbId +
      "?api_key=" +
      TMDB_KEY +
      "&append_to_response=alternative_titles,external_ids";
    return safeJson(url, HEADERS).then(function (data) {
      if (!data) return null;
      const genreIds = (data.genres || []).map(function (g) {
        return g.id;
      });
      const originCountries = data.origin_country || [];
      if (
        genreIds.indexOf(16) === -1 &&
        originCountries.indexOf("JP") === -1
      ) {
        return null;
      }
      const title = q.mediaType === "tv" ? data.name : data.title;
      const origTitle =
        q.mediaType === "tv" ? data.original_name : data.original_title;
      const alt = data.alternative_titles;
      const list = (alt && (alt.results || alt.titles)) || [];
      const altTitles = list.map(function (t) {
        return decodeHtmlEntities(t.title);
      });
      let absoluteOffset = 0;
      let seasonName = null;
      if (q.mediaType === "tv" && data.seasons) {
        for (let i = 0; i < data.seasons.length; i++) {
          const s = data.seasons[i];
          if (s.season_number > 0 && s.season_number < q.season) {
            absoluteOffset += s.episode_count || 0;
          }
          if (s.season_number === q.season) {
            seasonName = s.name;
          }
        }
      }
      return {
        kind: q.mediaType,
        title: decodeHtmlEntities(title || ""),
        originalTitle: origTitle ? decodeHtmlEntities(origTitle) : undefined,
        alternateTitles: altTitles,
        seasonName: seasonName,
        absoluteOffset: absoluteOffset,
      };
    });
  }

  function searchAnikoto(query) {
    if (!query || !String(query).trim()) return Promise.resolve([]);
    const term = encodeURIComponent(String(query).trim());
    return safeText(BASE_URL + "/filter?keyword=" + term, HEADERS).then(
      function (html) {
        if (html) {
          const matches = allMatches(
            html,
            /<div class="item [\s\S]*?<div class="ani poster tip" data-tip="(\d+)"[\s\S]*?<a class="name d-title" href="([^"]+)"(?:\s+data-jp="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/gi
          );
          if (matches.length > 0) {
            return matches.map(function (m) {
              return {
                id: m[1],
                url: m[2],
                jpTitle: m[3] ? decodeHtmlEntities(m[3].trim()) : undefined,
                title: decodeHtmlEntities(m[4].replace(/<[^>]+>/g, "").trim()),
              };
            });
          }
        }
        return safeJson(
          BASE_URL + "/ajax/anime/search?keyword=" + term,
          AJAX_HEADERS
        ).then(function (json) {
          const result = (json && json.result && json.result.html) || "";
          return allMatches(
            result,
            /<a class="item" href="([^"]+)"[\s\S]*?<div class="name d-title"[^>]*>([\s\S]*?)<\/div>/gi
          ).map(function (m) {
            return {
              id: "",
              url: m[1],
              title: decodeHtmlEntities(m[2].replace(/<[^>]+>/g, "").trim()),
            };
          });
        });
      }
    );
  }

  function pickCandidate(candidates, meta) {
    if (!candidates || !candidates.length) return null;
    const targets = [meta.title, meta.originalTitle]
      .concat(meta.alternateTitles || [])
      .map(normalizeTitle)
      .filter(Boolean);

    let best = candidates[0];
    let bestScore = -1;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const cn = normalizeTitle(c.title);
      const jn = c.jpTitle ? normalizeTitle(c.jpTitle) : "";
      let sc = 0;
      for (let j = 0; j < targets.length; j++) {
        const tn = targets[j];
        if ((cn && cn === tn) || (jn && jn === tn)) {
          sc = Math.max(sc, 100);
        } else if (
          (cn && (cn.indexOf(tn) !== -1 || tn.indexOf(cn) !== -1)) ||
          (jn && (jn.indexOf(tn) !== -1 || tn.indexOf(jn) !== -1))
        ) {
          sc = Math.max(sc, 70);
        }
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    return best;
  }

  function extractFromServer(server) {
    return safeJson(
      BASE_URL + "/ajax/server?get=" + encodeURIComponent(server.linkId),
      AJAX_HEADERS
    ).then(function (json) {
      const playerUrl = json && json.result && json.result.url;
      if (!playerUrl) return null;
      return safeText(
        playerUrl,
        Object.assign({}, HEADERS, { Referer: BASE_URL + "/" })
      ).then(function (playerHtml) {
        if (!playerHtml) return null;
        const dataIdMatch = playerHtml.match(/data-id="(\d+)"/);
        if (!dataIdMatch) return null;
        const playerOrigin = originOf(playerUrl);
        if (!playerOrigin) return null;
        const sParam = queryParam(playerUrl, "s") || "tcdn";
        const sourcesUrl =
          playerOrigin +
          "/stream/getSourcesNew?id=" +
          dataIdMatch[1] +
          "&s=" +
          encodeURIComponent(sParam);
        return safeJson(
          sourcesUrl,
          Object.assign({}, HEADERS, {
            Referer: playerUrl,
            "X-Requested-With": "XMLHttpRequest",
          })
        ).then(function (sourcesJson) {
          if (!sourcesJson) return null;
          let masterUrl = sourcesJson.sources && sourcesJson.sources.file;
          if (!masterUrl && sourcesJson.enc) {
            const decrypted = decryptAesCbc(sourcesJson.enc);
            masterUrl = decrypted && decrypted.file;
          }
          if (!masterUrl || typeof masterUrl !== "string") return null;
          if (masterUrl.indexOf("fetch.nexabloom.top") !== -1) {
            masterUrl = masterUrl.replace(
              "fetch.nexabloom.top",
              "ncdn.imgnex.top"
            );
          }
          const langName = server.type === "dub" ? "English" : "Japanese";
          const label =
            "Anikoto • " + langName + " • " + server.serverName;
          return {
            name: label,
            title: label,
            quality: "1080p",
            url: masterUrl,
            headers: { Referer: playerOrigin + "/", Origin: playerOrigin },
          };
        });
      });
    });
  }

  return getMeta()
    .then(function (meta) {
      if (!meta || !meta.title) return [];
      const queries = [meta.title, meta.originalTitle]
        .concat(meta.alternateTitles || [])
        .filter(Boolean)
        .slice(0, 5);

      return Promise.all(queries.map(searchAnikoto)).then(function (lists) {
        let merged = [];
        for (let i = 0; i < lists.length; i++) {
          merged = merged.concat(lists[i] || []);
        }
        const picked = pickCandidate(merged, meta);
        if (!picked) return [];

        const idPromise = picked.id
          ? Promise.resolve(picked.id)
          : safeText(BASE_URL + picked.url, HEADERS).then(function (html) {
              const m = html && html.match(/data-id="(\d+)"/);
              return m ? m[1] : null;
            });

        return idPromise.then(function (animeId) {
          if (!animeId) return [];
          return safeJson(
            BASE_URL +
              "/ajax/episode/list/" +
              encodeURIComponent(animeId),
            AJAX_HEADERS
          ).then(function (epJson) {
            const epHtml = (epJson && epJson.result) || "";
            const eps = allMatches(
              epHtml,
              /<a[^>]+data-id="(\d+)"[^>]+data-num="(\d+)"[^>]+data-ids="([^"]+)"/gi
            ).map(function (m) {
              return { id: m[1], num: parseInt(m[2], 10), dataIds: m[3] };
            });
            if (!eps.length) return [];

            const targetEp =
              eps.find(function (e) {
                return e.num === q.episode;
              }) ||
              eps.find(function (e) {
                return e.num === meta.absoluteOffset + q.episode;
              }) ||
              eps[q.episode - 1] ||
              null;

            if (!targetEp || !targetEp.dataIds) return [];

            return safeJson(
              BASE_URL +
                "/ajax/server/list?servers=" +
                encodeURIComponent(targetEp.dataIds),
              AJAX_HEADERS
            ).then(function (srvJson) {
              const srvHtml = (srvJson && srvJson.result) || "";
              const blocks = allMatches(
                srvHtml,
                /<div class="type" data-type="(sub|dub)">([\s\S]*?)<\/div>/gi
              );
              const servers = [];
              for (let b = 0; b < blocks.length; b++) {
                const items = allMatches(
                  blocks[b][2],
                  /<li[^>]*data-link-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi
                );
                for (let k = 0; k < items.length; k++) {
                  servers.push({
                    type: blocks[b][1],
                    linkId: items[k][1],
                    serverName: decodeHtmlEntities(
                      items[k][2].replace(/<[^>]+>/g, "").trim()
                    ),
                  });
                }
              }
              if (!servers.length) return [];
              return Promise.all(servers.map(extractFromServer)).then(
                function (resList) {
                  return dedupeByUrl(resList.filter(Boolean));
                }
              );
            });
          });
        });
      });
    })
    .catch(function () {
      return [];
    });
}

/* =========================================================================
 * Unified Nuvio Entrypoint
 * ========================================================================= */
function getStreams(id, mediaType, season, episode) {
  const q = normalizeInput(id, mediaType, season, episode);
  if (!q) return Promise.resolve([]);

  return Promise.all([
    fetchAniKageStreams(q).catch(function () {
      return [];
    }),
    fetchAnikotoStreams(q).catch(function () {
      return [];
    }),
  ])
    .then(function (results) {
      const combined = [].concat(results[0] || [], results[1] || []);
      return dedupeByUrl(combined);
    })
    .catch(function () {
      return [];
    });
}

if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
