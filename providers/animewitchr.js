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

async function getKitsuTitles(kitsuId) {
  const cleanId = String(kitsuId || "").replace(/^kitsu[:_-]?/i, "").trim();
  if (!/^\d+$/.test(cleanId)) return [];
  try {
    const res = await fetch(
      "https://kitsu.io/api/edge/anime/" + encodeURIComponent(cleanId),
      {
        headers: {
          Accept: "application/vnd.api+json",
          "User-Agent": UA["User-Agent"],
        },
      }
    );
    if (!res.ok) return [];
    const j = await res.json();
    const attrs = (j && j.data && j.data.attributes) || {};
    const titlesObj = attrs.titles || {};
    const list = [
      titlesObj.en,
      attrs.canonicalTitle,
      titlesObj.en_jp,
      titlesObj.ja_jp,
    ];
    if (Array.isArray(attrs.abbreviatedTitles)) {
      attrs.abbreviatedTitles.forEach(function (x) {
        list.push(x);
      });
    }
    return dedupeTitles(list);
  } catch (e) {
    return [];
  }
}

async function getMalTitles(malId) {
  const cleanId = String(malId || "").replace(/^mal[:_-]?/i, "").trim();
  if (!/^\d+$/.test(cleanId)) return [];
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": UA["User-Agent"],
      },
      body: JSON.stringify({
        query:
          "query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { title { romaji english native } synonyms } }",
        variables: { idMal: Number(cleanId) },
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const media = j && j.data && j.data.Media;
      if (media) {
        const t = media.title || {};
        const list = [t.english, t.romaji, t.native];
        if (Array.isArray(media.synonyms)) {
          media.synonyms.forEach(function (s) {
            list.push(s);
          });
        }
        const deduped = dedupeTitles(list);
        if (deduped.length) return deduped;
      }
    }
  } catch (e) {}

  try {
    const jRes = await fetch("https://api.jikan.moe/v4/anime/" + cleanId, {
      headers: UA,
    });
    if (!jRes.ok) return [];
    const jData = await jRes.json();
    const d = jData && jData.data;
    if (!d) return [];
    const list = [d.title_english, d.title, d.title_japanese];
    if (Array.isArray(d.title_synonyms)) {
      d.title_synonyms.forEach(function (s) {
        list.push(s);
      });
    }
    return dedupeTitles(list);
  } catch (e) {
    return [];
  }
}

async function getTmdbTitles(id, mediaType) {
  const raw = String(id || "").trim();
  if (!raw) return [];

  if (/^kitsu[:_-]/i.test(raw)) {
    return await getKitsuTitles(raw);
  }
  if (/^mal[:_-]/i.test(raw)) {
    return await getMalTitles(raw);
  }

  const cleanNumeric = raw.replace(/^(tmdb[:_-]?|tt)/i, "").trim();
  if (!/^\d+$/.test(cleanNumeric)) {
    const cleanedText = raw.replace(/^(anime|series|show)[:_-]/i, "").replace(/[-_]+/g, " ").trim();
    return cleanedText ? [cleanedText] : [];
  }

  const type = mediaType === "movie" ? "movie" : "tv";
  try {
    const res = await fetch(
      "https://api.themoviedb.org/3/" +
        type +
        "/" +
        cleanNumeric +
        "?api_key=" +
        TMDB_KEY +
        "&append_to_response=alternative_titles"
    );
    if (!res.ok) return [];
    const j = await res.json();
    const titles = [
      j.name || j.title,
      j.original_name || j.original_title,
    ].filter(Boolean);

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
  } catch (e) {
    return [];
  }
}

async function queryAlgoliaSeries(query) {
  const url =
    "https://" +
    DEFAULT_ALGOLIA.appId +
    "-dsn.algolia.net/1/indexes/series/query";
  const params = new URLSearchParams({
    query: String(query || ""),
    hitsPerPage: "10",
  }).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": DEFAULT_ALGOLIA.appId,
      "X-Algolia-API-Key": DEFAULT_ALGOLIA.apiKey,
      "Content-Type": "application/json; charset=UTF-8",
      "User-Agent": UA["User-Agent"],
    },
    body: JSON.stringify({ params: params }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json && json.hits) || [];
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

function scoreCandidate(tmdbTitles, cand, season) {
  const s = Number(season) || 1;
  const normNames = cand.names.map(normAscii).filter(Boolean);
  const joined = " " + normNames.join(" | ") + " ";

  let bestMatch = 0;
  tmdbTitles.forEach(function (t, idx) {
    const nt = normAscii(t);
    if (!nt) return;
    const weightBoost = idx === 0 ? 1.05 : 1.0;
    const tTokens = nt.split(" ").filter(function (w) {
      return w.length > 2;
    });

    normNames.forEach(function (nn) {
      if (nn === nt) {
        bestMatch = Math.max(bestMatch, 1.0 * weightBoost);
      } else if (nn.indexOf(nt) !== -1 || nt.indexOf(nn) !== -1) {
        bestMatch = Math.max(bestMatch, 0.85 * weightBoost);
      } else if (tTokens.length) {
        let matched = 0;
        tTokens.forEach(function (tok) {
          if ((" " + nn + " ").indexOf(" " + tok + " ") !== -1) matched++;
        });
        const ratio = matched / tTokens.length;
        bestMatch = Math.max(bestMatch, ratio * 0.8 * weightBoost);
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

async function resolveMatchedAnimeId(id, mediaType, season) {
  const raw = String(id || "").trim();
  if (!raw) return null;
  if (raw.indexOf("anime_list/") === 0) {
    return raw.replace(/^anime_list\//, "");
  }

  const titles = await getTmdbTitles(raw, mediaType);
  if (!titles.length) return null;

  const pool = {};
  const queries = titles.slice(0, 3);

  for (let i = 0; i < queries.length; i++) {
    const hits = await queryAlgoliaSeries(queries[i]);
    hits.forEach(function (h) {
      const info = collectHitInfo(h);
      if (!info.id) return;
      if (!pool[info.id]) {
        pool[info.id] = { id: info.id, names: [], isZeroEps: info.isZeroEps };
      }
      pool[info.id].names = pool[info.id].names.concat(info.names);
      if (info.isZeroEps) pool[info.id].isZeroEps = true;
    });
  }

  let best = null;
  Object.keys(pool).forEach(function (aid) {
    const sc = scoreCandidate(titles, pool[aid], season);
    if (sc > 0 && (!best || sc > best.score)) {
      best = { id: aid, score: sc };
    }
  });

  if (!best || best.score < 0.45) return null;
  return best.id;
}

function extractEpisodeNumberFromObj(ep) {
  if (!ep || typeof ep !== "object") return null;
  const directKeys = ["episode", "ep", "number", "episode_number", "ep_num"];
  for (let i = 0; i < directKeys.length; i++) {
    const v = ep[directKeys[i]];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      const n = Number(String(v).replace(/[^\d]/g, ""));
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return null;
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

  const byField = episodes.find(function (ep) {
    if (!ep || !ep.doc_id) return false;
    return extractEpisodeNumberFromObj(ep) === target;
  });
  if (byField) return String(byField.doc_id);

  const byName = episodes.find(function (ep) {
    if (!ep || !ep.doc_id) return false;
    const epMatch = String(ep.name || "").match(
      /(?:ep(?:isode)?|حلقة)\s*0*(\d+)/i
    );
    if (epMatch) return Number(epMatch[1]) === target;
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

async function verifyPlayableStream(url) {
  try {
    let res = await fetch(url, {
      method: "HEAD",
      headers: UA,
      redirect: "follow",
    });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": UA["User-Agent"],
          Range: "bytes=0-15",
        },
        redirect: "follow",
      });
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const isMedia =
      ct.indexOf("video/") !== -1 ||
      ct.indexOf("application/octet-stream") !== -1;
    if (!res.ok || !isMedia) return null;
    return res.url || url;
  } catch (e) {
    return null;
  }
}

async function getStreams(id, mediaType, season, episode) {
  try {
    const isMovie = mediaType === "movie";
    const parsedEp = Number(episode);
    const epNum = isMovie ? 1 : parsedEp > 0 ? parsedEp : 1;

    const animeId = await resolveMatchedAnimeId(id, mediaType, season);
    if (!animeId) return [];

    const cleanAnime = encodeURIComponent(animeId);
    const epRes = await fetch(
      firestoreDocUrl("anime_list/" + cleanAnime + "/episodes_summery/summery")
    );
    if (!epRes.ok) return [];

    const epDoc = parseFirestoreDoc(await epRes.json());
    const episodes = Array.isArray(epDoc.episodes) ? epDoc.episodes : [];
    const epDocId = pickEpisodeDocId(episodes, epNum);
    if (!epDocId) return [];

    const srvRes = await fetch(
      firestoreDocUrl(
        "anime_list/" +
          cleanAnime +
          "/episodes/" +
          encodeURIComponent(epDocId) +
          "/servers2/all_servers"
      )
    );
    if (!srvRes.ok) return [];

    const srvDoc = parseFirestoreDoc(await srvRes.json());
    const servers = Array.isArray(srvDoc.servers) ? srvDoc.servers : [];

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

    const verifiedList = await Promise.all(
      candidates.map(async function (c) {
        const finalUrl = await verifyPlayableStream(c.url);
        if (!finalUrl) return null;
        return {
          name: "AnimeWitcher",
          title:
            animeId + " - Ep " + epDocId + " (" + c.name + " " + c.quality + ")",
          quality: c.quality,
          url: finalUrl,
          headers: UA,
        };
      })
    );

    return verifiedList.filter(Boolean);
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
