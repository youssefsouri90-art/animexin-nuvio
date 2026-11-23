const FIREBASE_PROJECT_ID = "animewitcher-1c66d";
const FIREBASE_API_KEY = "AIzaSyAcbWRwfFNnCpoydDXlEALWnM_TYVcJOMU";

const DEFAULT_ALGOLIA = {
  appId: "TVNESH8OZY",
  apiKey: "54098ae17637c217f486e6165c8a913c",
};

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0",
};

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

function getAlgoliaConfig() {
  return fetch(firestoreDocUrl("Settings/constants"))
    .then(function (res) {
      if (!res.ok) return DEFAULT_ALGOLIA;
      return res.json().then(function (json) {
        const data = parseFirestoreDoc(json);
        const searchSettings = data.search_settings || {};
        return {
          appId: searchSettings.app_id || DEFAULT_ALGOLIA.appId,
          apiKey:
            searchSettings.api_key ||
            searchSettings.browse_api_key ||
            DEFAULT_ALGOLIA.apiKey,
        };
      });
    })
    .catch(function () {
      return DEFAULT_ALGOLIA;
    });
}

function queryAlgolia(index, paramsObj) {
  const params = new URLSearchParams(paramsObj || {}).toString();
  return getAlgoliaConfig().then(function (cfg) {
    const url =
      "https://" +
      cfg.appId +
      "-dsn.algolia.net/1/indexes/" +
      encodeURIComponent(index) +
      "/query";
    return fetch(url, {
      method: "POST",
      headers: {
        "X-Algolia-Application-Id": cfg.appId,
        "X-Algolia-API-Key": cfg.apiKey,
        "Content-Type": "application/json; charset=UTF-8",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
      },
      body: JSON.stringify({ params: params }),
    }).then(function (res) {
      if (!res.ok) {
        throw new Error("Algolia query failed (" + index + "): " + res.status);
      }
      return res.json().then(function (json) {
        return (json && json.hits) || [];
      });
    });
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

function resolveAnimeId(queryOrId) {
  const raw = String(queryOrId || "").trim();
  if (!raw) return Promise.resolve("");
  if (raw.indexOf("anime_list/") === 0) {
    return Promise.resolve(raw.replace(/^anime_list\//, ""));
  }
  return queryAlgolia("series", {
    query: raw,
    hitsPerPage: "5",
  }).then(function (hits) {
    if (!hits || !hits.length) return raw;
    const exact = hits.find(function (h) {
      const id = extractAnimeId(h);
      const enTitle =
        (h.alternative_titles && h.alternative_titles.en) ||
        (h.details && h.details.english_title) ||
        "";
      return (
        id.toLowerCase() === raw.toLowerCase() ||
        String(h.mal_id || "") === raw ||
        enTitle.toLowerCase() === raw.toLowerCase()
      );
    });
    return extractAnimeId(exact || hits[0]) || raw;
  });
}

function pickEpisodeDocId(episodes, episodeNum) {
  if (!Array.isArray(episodes) || !episodes.length) return null;
  const target = Number(episodeNum) || 1;
  const padded = String(target).padStart(3, "0");

  const byDocId = episodes.find(function (ep) {
    return (
      String(ep && ep.doc_id) === padded ||
      String(ep && ep.doc_id) === String(target)
    );
  });
  if (byDocId && byDocId.doc_id) return String(byDocId.doc_id);

  const byName = episodes.find(function (ep) {
    const name = String((ep && ep.name) || "");
    const match = name.match(/(\d+)/);
    return match && Number(match[1]) === target;
  });
  if (byName && byName.doc_id) return String(byName.doc_id);

  const idx = Math.max(0, Math.min(episodes.length - 1, target - 1));
  return episodes[idx] && episodes[idx].doc_id ? String(episodes[idx].doc_id) : null;
}

function resolveDirectCandidate(rawLink) {
  if (!rawLink || typeof rawLink !== "string") return null;
  const trimmed = rawLink.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  if (trimmed.indexOf("pixeldrain.com/u/") !== -1) {
    const id = trimmed.split("/u/")[1].split(/[/?#]/)[0];
    if (!id) return null;
    return "https://pixeldrain.com/api/file/" + id;
  }

  return trimmed;
}

function verifyPlayableStream(url) {
  function checkHeaders(res) {
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const isMedia =
      contentType.indexOf("video/") !== -1 ||
      contentType.indexOf("application/octet-stream") !== -1 ||
      contentType.indexOf("application/vnd.apple.mpegurl") !== -1 ||
      contentType.indexOf("application/x-mpegurl") !== -1;

    if (!res.ok || !isMedia) return null;
    return {
      url: res.url || url,
      mimeType: contentType,
    };
  }

  return fetch(url, {
    method: "HEAD",
    headers: DEFAULT_HEADERS,
    redirect: "follow",
  })
    .then(function (res) {
      if (res.status === 405 || res.status === 403) {
        return fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": DEFAULT_HEADERS["User-Agent"],
            Range: "bytes=0-15",
          },
          redirect: "follow",
        }).then(checkHeaders);
      }
      return checkHeaders(res);
    })
    .catch(function () {
      return null;
    });
}

function getStreams(id, mediaType, season, episode) {
  const epNumber =
    typeof season === "number" && typeof episode === "number"
      ? episode
      : typeof mediaType === "number"
      ? mediaType
      : Number(episode || season || 1) || 1;

  return resolveAnimeId(id).then(function (animeId) {
    const cleanAnime = encodeURIComponent(String(animeId || "").trim());
    if (!cleanAnime) return [];

    return fetch(
      firestoreDocUrl("anime_list/" + cleanAnime + "/episodes_summery/summery")
    )
      .then(function (res) {
        if (!res.ok) return null;
        return res.json().then(function (json) {
          const doc = parseFirestoreDoc(json);
          const episodes = Array.isArray(doc.episodes) ? doc.episodes : [];
          return pickEpisodeDocId(episodes, epNumber);
        });
      })
      .then(function (epDocId) {
        const targetEp = encodeURIComponent(
          epDocId || String(epNumber).padStart(3, "0")
        );
        return fetch(
          firestoreDocUrl(
            "anime_list/" +
              cleanAnime +
              "/episodes/" +
              targetEp +
              "/servers2/all_servers"
          )
        );
      })
      .then(function (res) {
        if (!res || !res.ok) return [];
        return res.json().then(function (json) {
          const doc = parseFirestoreDoc(json);
          const servers = Array.isArray(doc.servers) ? doc.servers : [];

          const candidates = servers
            .filter(function (srv) {
              return srv && srv.visible !== false && srv.link;
            })
            .map(function (srv) {
              return {
                name: srv.name || "Server",
                quality: srv.quality || "Auto",
                candidateUrl: resolveDirectCandidate(srv.link),
              };
            })
            .filter(function (item) {
              return Boolean(item.candidateUrl);
            });

          return Promise.all(
            candidates.map(function (item) {
              return verifyPlayableStream(item.candidateUrl).then(
                function (verified) {
                  if (!verified) return null;
                  return {
                    name: "AnimeWitcher",
                    title: item.name + " - " + item.quality,
                    quality: item.quality,
                    url: verified.url,
                    mimeType: verified.mimeType,
                    headers: DEFAULT_HEADERS,
                  };
                }
              );
            })
          ).then(function (results) {
            return results.filter(Boolean);
          });
        });
      })
      .catch(function () {
        return [];
      });
  });
}

module.exports = {
  getStreams: getStreams,
};
