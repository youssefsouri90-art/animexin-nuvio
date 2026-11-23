const FIREBASE_PROJECT_ID = "animewitcher-1c66d";
const FIREBASE_API_KEY = "AIzaSyAcbWRwfFNnCpoydDXlEALWnM_TYVcJOMU";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

const DEFAULT_ALGOLIA = {
  appId: "TVNESH8OZY",
  apiKey: "54098ae17637c217f486e6165c8a913c",
};

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
};

function normAscii(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeTitles(list) {
  const seen = {};
  return (Array.isArray(list) ? list : [])
    .filter(Boolean)
    .filter(function (t) {
      const k = normAscii(t) || String(t).trim().toLowerCase();
      if (!k || seen[k]) return false;
      seen[k] = true;
      return true;
    });
}

function firestoreDocUrl(docPath) {
  return (
    "https://firestore.googleapis.com/v1/projects/" +
    FIREBASE_PROJECT_ID +
    "/databases/(default)/documents/" +
    docPath +
    "?key=" +
    FIREBASE_API_KEY
  );
}

function parseFirestoreValue(val) {
  if (!val || typeof val !== "object") return null;
  if ("stringValue" in val) return val.stringValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return Number(val.doubleValue);
  if ("nullValue" in val) return null;
  if ("arrayValue" in val) {
    const arr = (val.arrayValue && val.arrayValue.values) || [];
    return arr.map(parseFirestoreValue);
  }
  if ("mapValue" in val) {
    const out = {};
    const fields = (val.mapValue && val.mapValue.fields) || {};
    Object.keys(fields).forEach(function (k) {
      out[k] = parseFirestoreValue(fields[k]);
    });
    return out;
  }
  return null;
}

function parseFirestoreDoc(doc) {
  const out = {};
  const fields = (doc && doc.fields) || {};
  Object.keys(fields).forEach(function (k) {
    out[k] = parseFirestoreValue(fields[k]);
  });
  return out;
}

function getTmdbTitlesByNumericId(numId, mediaType) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const url =
    "https://api.themoviedb.org/3/" +
    type +
    "/" +
    numId +
    "?api_key=" +
    TMDB_KEY +
    "&append_to_response=alternative_titles";

  return fetch(url)
    .then(function (res) {
      if (!res || !res.ok) return null;
      return res.json();
    })
    .then(function (j) {
      if (!j) return [];
      const titles = [j.name || j.title, j.original_name || j.original_title];
      const alt =
        (j.alternative_titles &&
          (j.alternative_titles.results || j.alternative_titles.titles)) ||
        [];
      alt.forEach(function (a) {
        if (a && a.title && /^(US|GB|JP)$/.test(a.iso_3166_1 || "")) {
          titles.push(a.title);
        }
      });
      return dedupeTitles(titles);
    })
    .catch(function () {
      return [];
    });
}

function getKitsuTitles(kitsuId) {
  const cleanId = String(kitsuId || "").replace(/^kitsu[:_-]?/i, "").trim();
  if (!/^\d+$/.test(cleanId)) return Promise.resolve([]);

  return fetch("https://kitsu.io/api/edge/anime/" + encodeURIComponent(cleanId), {
    headers: {
      Accept: "application/vnd.api+json",
      "User-Agent": UA["User-Agent"],
    },
  })
    .then(function (res) {
      if (!res || !res.ok) return null;
      return res.json();
    })
    .then(function (j) {
      if (!j) return [];
      const attrs = (j.data && j.data.attributes) || {};
      const titlesObj = attrs.titles || {};
      return dedupeTitles([
        attrs.canonicalTitle,
        titlesObj.en,
        titlesObj.en_jp,
        titlesObj.ja_jp,
        ...(Array.isArray(attrs.abbreviatedTitles)
          ? attrs.abbreviatedTitles
          : []),
      ]);
    })
    .catch(function () {
      return [];
    });
}

function getAnimeTitles(id, mediaType) {
  const raw = String(id || "").trim();
  if (!raw) return Promise.resolve([]);

  if (/^kitsu[:_-]/i.test(raw)) {
    return getKitsuTitles(raw);
  }
  if (/^tmdb[:_-]/i.test(raw)) {
    return getTmdbTitlesByNumericId(
      raw.replace(/^tmdb[:_-]/i, "").trim(),
      mediaType
    );
  }
  if (!/^\d+$/.test(raw)) {
    return Promise.resolve(dedupeTitles([raw]));
  }

  return getTmdbTitlesByNumericId(raw, mediaType).then(function (tmdbTitles) {
    if (tmdbTitles && tmdbTitles.length) return tmdbTitles;
    return getKitsuTitles(raw);
  });
}

function queryAlgoliaSeries(query) {
  const url =
    "https://" +
    DEFAULT_ALGOLIA.appId +
    "-dsn.algolia.net/1/indexes/series/query";
  const params = new URLSearchParams({
    query: String(query || ""),
    hitsPerPage: "10",
  }).toString();

  return fetch(url, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": DEFAULT_ALGOLIA.appId,
      "X-Algolia-API-Key": DEFAULT_ALGOLIA.apiKey,
      "Content-Type": "application/json; charset=UTF-8",
      "User-Agent": UA["User-Agent"],
    },
    body: JSON.stringify({ params: params }),
  })
    .then(function (res) {
      if (!res || !res.ok) return null;
      return res.json();
    })
    .then(function (json) {
      return (json && json.hits) || [];
    })
    .catch(function () {
      return [];
    });
}

function extractAnimeId(hit) {
  if (!hit || typeof hit !== "object") return "";
  if (hit.path && typeof hit.path === "string") {
    const parts = hit.path.split("/").filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1];
  }
  return hit.objectID ? String(hit.objectID) : "";
}

function collectHitInfo(hit) {
  const names = [];
  const id = extractAnimeId(hit);
  if (id) names.push(id);
  if (hit.objectID) names.push(String(hit.objectID));

  if (Array.isArray(hit.search_names)) {
    hit.search_names.forEach(function (n) {
      if (n) names.push(n);
    });
  }
  if (hit.alternative_titles && typeof hit.alternative_titles === "object") {
    ["en", "ja", "romaji", "title"].forEach(function (k) {
      if (hit.alternative_titles[k]) names.push(hit.alternative_titles[k]);
    });
    if (Array.isArray(hit.alternative_titles.synonyms)) {
      hit.alternative_titles.synonyms.forEach(function (s) {
        if (s) names.push(s);
      });
    }
  }
  if (hit.details && hit.details.english_title) {
    names.push(hit.details.english_title);
  }

  const epsText = String((hit.details && hit.details.eps_num) || "");
  const isZeroEps = /^\s*0\s*حلقة/.test(epsText);

  return {
    id: id,
    names: names,
    isZeroEps: isZeroEps,
  };
}

function scoreCandidate(candidateTitles, cand, season) {
  const s = Number(season) || 1;
  const normNames = cand.names.map(normAscii).filter(Boolean);
  const joined = " " + normNames.join(" | ") + " ";

  let bestMatch = 0;
  candidateTitles.forEach(function (t) {
    const nt = normAscii(t);
    if (!nt) return;
    const tTokens = nt.split(" ").filter(function (w) {
      return w.length > 2;
    });

    normNames.forEach(function (nn) {
      if (nn === nt) {
        bestMatch = Math.max(bestMatch, 1.0);
      } else if (nn.indexOf(nt) !== -1 || nt.indexOf(nn) !== -1) {
        bestMatch = Math.max(bestMatch, 0.85);
      } else if (tTokens.length) {
        let matched = 0;
        tTokens.forEach(function (tok) {
          if ((" " + nn + " ").indexOf(" " + tok + " ") !== -1) matched++;
        });
        const ratio = matched / tTokens.length;
        bestMatch = Math.max(bestMatch, ratio * 0.8);
      }
    });
  });

  if (bestMatch <= 0) return -1;

  let score = bestMatch;
  if (cand.isZeroEps) score -= 0.7;

  const isSeason2 =
    joined.indexOf(" 2nd season ") !== -1 ||
    joined.indexOf(" season 2 ") !== -1 ||
    joined.indexOf(" 第2期 ") !== -1;
  const isSeason3Plus =
    joined.indexOf(" 3rd season ") !== -1 ||
    joined.indexOf(" season 3 ") !== -1 ||
    joined.indexOf(" season 4 ") !== -1 ||
    joined.indexOf(" golden land ") !== -1;

  if (s <= 1) {
    if (isSeason2 || isSeason3Plus) score -= 0.5;
    else score += 0.15;
  } else if (s === 2) {
    if (isSeason2) score += 0.45;
    else score -= 0.25;
  } else if (s >= 3) {
    if (isSeason3Plus || joined.indexOf(" season " + s + " ") !== -1) {
      score += 0.45;
    } else {
      score -= 0.25;
    }
  }

  return score;
}

function resolveMatchedAnimeId(id, mediaType, season) {
  const raw = String(id || "").trim();
  if (!raw) return Promise.resolve(null);
  if (raw.indexOf("anime_list/") === 0) {
    return Promise.resolve(raw.replace(/^anime_list\//, ""));
  }

  return getAnimeTitles(raw, mediaType).then(function (titles) {
    if (!titles || !titles.length) return null;

    const pool = {};
    const queries = titles.slice(0, 3);

    return queries
      .reduce(function (chain, q) {
        return chain.then(function () {
          return queryAlgoliaSeries(q).then(function (hits) {
            hits.forEach(function (h) {
              const info = collectHitInfo(h);
              if (!info.id) return;
              if (!pool[info.id]) {
                pool[info.id] = {
                  id: info.id,
                  names: [],
                  isZeroEps: info.isZeroEps,
                };
              }
              pool[info.id].names = pool[info.id].names.concat(info.names);
              if (info.isZeroEps) pool[info.id].isZeroEps = true;
            });
          });
        });
      }, Promise.resolve())
      .then(function () {
        let best = null;
        Object.keys(pool).forEach(function (aid) {
          const sc = scoreCandidate(titles, pool[aid], season);
          if (sc > 0 && (!best || sc > best.score)) {
            best = { id: aid, score: sc };
          }
        });
        if (!best || best.score < 0.45) return null;
        return best.id;
      });
  });
}

function pickEpisodeDocId(episodes, episodeNum) {
  if (!Array.isArray(episodes) || !episodes.length) return null;
  const target = Number(episodeNum) || 1;
  const padded = String(target).padStart(3, "0");

  const exactDoc = episodes.find(function (ep) {
    if (!ep || !ep.doc_id) return false;
    const d = String(ep.doc_id).trim();
    return (
      d === padded ||
      d === String(target) ||
      String(Number(d)) === String(target)
    );
  });
  if (exactDoc) return String(exactDoc.doc_id);

  const byName = episodes.find(function (ep) {
    if (!ep || !ep.doc_id) return false;
    const m = String(ep.name || "").match(/(\d+)/);
    return m && Number(m[1]) === target;
  });
  if (byName) return String(byName.doc_id);

  return null;
}

function resolveDirectCandidate(rawLink) {
  if (!rawLink || typeof rawLink !== "string") return null;
  const trimmed = rawLink.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  if (trimmed.indexOf("pixeldrain.com/u/") !== -1) {
    const fileId = trimmed.split("/u/")[1].split(/[/?#]/)[0];
    if (!fileId) return null;
    return "https://pixeldrain.com/api/file/" + fileId;
  }

  return null;
}

function verifyPlayableStream(url) {
  return fetch(url, {
    method: "HEAD",
    headers: UA,
    redirect: "follow",
  })
    .then(function (res) {
      if (res && (res.status === 405 || res.status === 403)) {
        return fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": UA["User-Agent"],
            Range: "bytes=0-15",
          },
          redirect: "follow",
        });
      }
      return res;
    })
    .then(function (res) {
      if (!res) return null;
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const isMedia =
        ct.indexOf("video/") !== -1 ||
        ct.indexOf("application/octet-stream") !== -1;
      if (!res.ok || !isMedia) return null;
      return res.url || url;
    })
    .catch(function () {
      return null;
    });
}

function getStreams(id, mediaType, season, episode) {
  const isMovie = mediaType === "movie";
  const epNum = isMovie ? 1 : Number(episode || season || 1) || 1;
  let resolvedAnimeId = null;
  let resolvedEpDocId = null;

  return resolveMatchedAnimeId(id, mediaType, season)
    .then(function (animeId) {
      if (!animeId) return null;
      resolvedAnimeId = animeId;
      const cleanAnime = encodeURIComponent(animeId);
      return fetch(
        firestoreDocUrl("anime_list/" + cleanAnime + "/episodes_summery/summery")
      )
        .then(function (epRes) {
          if (!epRes || !epRes.ok) return null;
          return epRes.json();
        })
        .then(function (rawEp) {
          if (!rawEp) return null;
          const epDoc = parseFirestoreDoc(rawEp);
          const episodes = Array.isArray(epDoc.episodes) ? epDoc.episodes : [];
          const epDocId = pickEpisodeDocId(episodes, epNum);
          if (!epDocId) return null;
          resolvedEpDocId = epDocId;

          return fetch(
            firestoreDocUrl(
              "anime_list/" +
                cleanAnime +
                "/episodes/" +
                encodeURIComponent(epDocId) +
                "/servers2/all_servers"
            )
          )
            .then(function (srvRes) {
              if (!srvRes || !srvRes.ok) return null;
              return srvRes.json();
            })
            .then(function (rawSrv) {
              if (!rawSrv) return [];
              const srvDoc = parseFirestoreDoc(rawSrv);
              const servers = Array.isArray(srvDoc.servers)
                ? srvDoc.servers
                : [];

              const candidates = servers
                .filter(function (srv) {
                  return srv && srv.visible !== false && srv.link;
                })
                .map(function (srv) {
                  return {
                    name: srv.name || "PD",
                    quality: srv.quality || "Auto",
                    url: resolveDirectCandidate(srv.link),
                  };
                })
                .filter(function (c) {
                  return Boolean(c.url);
                });

              return Promise.all(
                candidates.map(function (c) {
                  return verifyPlayableStream(c.url).then(function (finalUrl) {
                    if (!finalUrl) return null;
                    return {
                      name: "AnimeWitcher",
                      title:
                        resolvedAnimeId +
                        " - Ep " +
                        resolvedEpDocId +
                        " (" +
                        c.name +
                        " " +
                        c.quality +
                        ")",
                      quality: c.quality,
                      url: finalUrl,
                      headers: UA,
                    };
                  });
                })
              ).then(function (list) {
                return list.filter(Boolean);
              });
            });
        });
    })
    .then(function (res) {
      return Array.isArray(res) ? res : [];
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
