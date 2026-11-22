// Vivarium provider for Nuvio.
// Current support is limited to movies because the supplied HAR records a movie
// stream request, but does not record the site's TV-episode request format.
// API flow observed in HAR:
//   GET /api/es?id=<TMDB_ID>&type=movie&dubs=1  (Server-Sent Events)
//   GET /api/os?type=movie&id=<TMDB_ID>        (subtitle list)

const BASE = "https://vivarium.st";
const UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

const SITE_HEADERS = {
  "User-Agent": UA,
  Referer: BASE + "/",
  Origin: BASE,
};

function asText(value) {
  return value == null ? "" : String(value);
}

function parseSSE(text) {
  const records = [];
  let eventName = "message";
  let dataLines = [];

  function flush() {
    if (dataLines.length) {
      records.push({ event: eventName, data: dataLines.join("\n") });
    }
    eventName = "message";
    dataLines = [];
  }

  const lines = asText(text).replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      flush();
      continue;
    }
    if (line.charAt(0) === ":") continue;

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.charAt(0) === " ") value = value.slice(1);

    if (field === "event") eventName = value || "message";
    else if (field === "data") dataLines.push(value);
  }
  flush();
  return records;
}

function parseEventData(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function normalizeSubtitle(item) {
  if (!item || typeof item !== "object") return null;
  const url = asText(item.url || item.file || item.src).trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const lang = asText(item.lang || item.language || item.code).trim();
  const label = asText(item.label || item.name || item.title || lang || "Subtitle").trim();
  return {
    url,
    lang: lang || "und",
    language: lang || "und",
    label,
    name: label,
  };
}

function collectSubtitles(streams, separateSubs) {
  const result = [];
  const seen = Object.create(null);
  const add = (raw) => {
    const sub = normalizeSubtitle(raw);
    if (!sub || seen[sub.url]) return;
    seen[sub.url] = true;
    result.push(sub);
  };

  (streams || []).forEach((stream) => {
    (stream && Array.isArray(stream.subs) ? stream.subs : []).forEach(add);
  });
  (separateSubs || []).forEach(add);
  return result;
}

async function getSiteSubtitles(tmdbId) {
  try {
    const url = BASE + "/api/os?type=movie&id=" + encodeURIComponent(tmdbId);
    const response = await fetch(url, {
      headers: Object.assign({}, SITE_HEADERS, { Accept: "application/json" }),
    });
    if (response && response.ok === false) return [];
    const json = await response.json();
    return json && Array.isArray(json.subtitles) ? json.subtitles : [];
  } catch (e) {
    return [];
  }
}

function toNuvioStreams(records, separateSubs) {
  const sourceRows = [];
  records.forEach((record) => {
    if (record.event !== "source") return;
    const payload = parseEventData(record.data);
    if (!payload || !Array.isArray(payload.streams)) return;
    payload.streams.forEach((stream) => {
      if (stream && typeof stream === "object") {
        sourceRows.push({ sourceName: payload.provider, stream });
      }
    });
  });

  const subtitles = collectSubtitles(
    sourceRows.map((row) => row.stream),
    separateSubs
  );
  const output = [];
  const seen = Object.create(null);

  sourceRows.forEach(({ sourceName, stream }) => {
    const url = asText(stream.url).trim();
    if (!/^https?:\/\//i.test(url) || seen[url]) return;
    seen[url] = true;

    const quality = asText(stream.quality || "Auto").trim();
    const language = asText(stream.lang).trim();
    const source = asText(sourceName || stream.provider || "Vivarium").trim();
    const details = [source, quality, language].filter(Boolean).join(" - ");

    output.push({
      name: "Vivarium",
      title: details || "Vivarium stream",
      url,
      quality,
      headers: Object.assign({}, SITE_HEADERS),
      subtitles: subtitles.slice(),
      provider: "vivarium",
      type: asText(stream.type || "").toLowerCase(),
    });
  });

  return output;
}

async function getStreams(tmdbId, mediaType) {
  if (mediaType && mediaType !== "movie") return [];
  if (tmdbId == null || asText(tmdbId).trim() === "") return [];

  const id = asText(tmdbId).trim();
  const streamUrl =
    BASE + "/api/es?id=" + encodeURIComponent(id) + "&type=movie&dubs=1";

  try {
    const results = await Promise.all([
      fetch(streamUrl, {
        headers: Object.assign({}, SITE_HEADERS, { Accept: "text/event-stream" }),
      }),
      getSiteSubtitles(id),
    ]);
    const response = results[0];
    const separateSubs = results[1];
    if (response && response.ok === false) return [];
    const body = await response.text();
    return toNuvioStreams(parseSSE(body), separateSubs);
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams, parseSSE, normalizeSubtitle, toNuvioStreams };
