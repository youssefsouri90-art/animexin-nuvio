// Animexin provider for Nuvio (QuickJS runtime: no DOM, no Node APIs).
// Flow: TMDB title -> search animexin.dev -> episode page -> decode server
// <option> values (base64 iframe) -> resolve host -> direct m3u8/mp4.

const BASE = "https://animexin.dev";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
};

// ---------- helpers ----------
function b64decode(str) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  str = String(str).replace(/[^A-Za-z0-9+/]/g, "");
  let out = "", bits = 0, val = 0;
  for (let i = 0; i < str.length; i++) {
    val = (val << 6) | chars.indexOf(str[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((val >> bits) & 0xff);
    }
  }
  return out;
}

const norm = (s) =>
  String(s || "").toLowerCase().replace(/&#8217;|&#039;|’|'/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

function similarity(a, b) {
  const A = new Set(norm(a).split(" ")), B = new Set(norm(b).split(" "));
  let hit = 0;
  A.forEach((w) => B.has(w) && hit++);
  return hit / Math.max(A.size, B.size, 1);
}

async function getText(url, headers) {
  const r = await fetch(url, { headers: Object.assign({}, UA, headers || {}) });
  return await r.text();
}

// ---------- TMDB ----------
async function getTitles(tmdbId, mediaType) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const r = await fetch(
    `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`
  );
  const j = await r.json();
  return [j.name || j.title, j.original_name || j.original_title].filter(Boolean);
}

// ---------- site ----------
async function search(query) {
  const html = await getText(`${BASE}/?s=${encodeURIComponent(query)}`);
  const results = [], seen = {};
  const re = /<a[^>]+href="(https:\/\/animexin\.dev\/[^"#?]+)"[^>]*title="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (/-episode-\d+/.test(url) || /\/(genres|network|author|page|anime)\//.test(url)) continue;
    if (seen[url]) continue;
    seen[url] = 1;
    results.push({ url, title: m[2] });
  }
  return results;
}

async function findSeries(titles, mediaType, season) {
  const queries = [];
  titles.forEach((t) => {
    if (mediaType === "tv" && season > 1) queries.push(`${t} season ${season}`);
    queries.push(t);
  });
  let best = null;
  for (const q of queries) {
    const res = await search(q);
    for (const r of res) {
      let score = similarity(q, r.title);
      if (mediaType === "tv" && season > 1 && new RegExp(`season ${season}\\b`, "i").test(r.title)) score += 0.3;
      if (!best || score > best.score) best = Object.assign({ score }, r);
    }
    if (best && best.score >= 0.8) break;
  }
  return best && best.score >= 0.5 ? best : null;
}

async function findEpisodeUrl(seriesUrl, episode) {
  const html = await getText(seriesUrl);
  const re = /href="(https:\/\/animexin\.dev\/[^"]*-episode-(\d+)(?:-end)?-[^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (parseInt(m[2], 10) === Number(episode)) return m[1];
  }
  return null;
}

function extractServers(html) {
  const servers = [];
  const re = /<option[^>]*value="([^"]+)"[^>]*>([^<]*)<\/option>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1] || m[1].length < 20) continue;
    const decoded = b64decode(m[1]);
    const src = /<iframe[^>]+src=["']([^"']+)["']/i.exec(decoded);
    if (src) servers.push({ label: m[2].trim(), url: src[1].replace(/^\/\//, "https://") });
  }
  // fallback: default iframe in the page
  if (!servers.length) {
    const f = /<iframe[^>]+src=["']([^"']+)["']/i.exec(html);
    if (f) servers.push({ label: "Default", url: f[1] });
  }
  return servers;
}

// ---------- resolvers ----------
async function resolveDailymotion(url) {
  const id = (/[?&]video=([^&]+)/.exec(url) || /\/video\/([^?_]+)/.exec(url) || [])[1];
  if (!id) return [];
  const j = await (await fetch(`https://www.dailymotion.com/player/metadata/video/${id}`, { headers: UA })).json();
  const auto = j && j.qualities && j.qualities.auto && j.qualities.auto[0];
  return auto ? [{ url: auto.url, quality: "Auto", type: "hls" }] : [];
}

async function resolveOkru(url) {
  const id = (/videoembed\/(\d+)/.exec(url) || /video\/(\d+)/.exec(url) || [])[1];
  if (!id) return [];
  const html = await getText(`https://ok.ru/videoembed/${id}`, { Referer: "https://ok.ru/" });
  const opt = /data-options="([^"]+)"/.exec(html);
  if (!opt) return [];
  const json = opt[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const meta = JSON.parse(JSON.parse(json).flashvars.metadata);
  if (meta.hlsManifestUrl) return [{ url: meta.hlsManifestUrl, quality: "Auto", type: "hls" }];
  return (meta.videos || []).map((v) => ({ url: v.url, quality: v.name, type: "mp4" }));
}

async function resolveRumble(url) {
  const id = (/\/embed\/([^/?]+)/.exec(url) || [])[1];
  if (!id) return [];
  const j = await (await fetch(`https://rumble.com/embedJS/u3/?request=video&ver=2&v=${id}`, { headers: UA })).json();
  const out = [];
  if (j.ua && j.ua.hls && j.ua.hls.auto) out.push({ url: j.ua.hls.auto.url, quality: "Auto", type: "hls" });
  return out;
}

async function resolve(server) {
  const u = server.url;
  try {
    if (/dailymotion\.com/.test(u)) return await resolveDailymotion(u);
    if (/ok\.ru/.test(u)) return await resolveOkru(u);
    if (/rumble\.com/.test(u)) return await resolveRumble(u);
  } catch (e) {}
  return []; // Odysee / Mega / Dood: not supported yet
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  const fail = (m) => [{ name: "Animexin DEBUG", title: dbg.concat(m).join(" > "), url: "https://debug.invalid/", quality: "debug" }];
  try {
    const titles = await getTitles(tmdbId, mediaType);
    dbg.push("titles=" + titles.join("|"));
    if (!titles.length) return fail("no titles");
    const series = await findSeries(titles, mediaType, Number(season) || 1);
    dbg.push("series=" + (series ? series.url : "none"));
    if (!series) return fail("series not found");

    let pageUrl = series.url;
    if (mediaType === "tv") {
      pageUrl = await findEpisodeUrl(series.url, episode || 1);
      dbg.push("ep=" + pageUrl);
      if (!pageUrl) return fail("episode not found");
    }

    const servers = extractServers(await getText(pageUrl));
    dbg.push("servers=" + servers.length);
    const streams = [];
    await Promise.all(
      servers.map(async (s) => {
        const links = await resolve(s);
        links.forEach((l) =>
          streams.push({ name: "Animexin", title: s.label, url: l.url, quality: l.quality, headers: UA, provider: "animexin" })
        );
      })
    );
    return streams.length ? streams : fail("no playable streams");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams };
