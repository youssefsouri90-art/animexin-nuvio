// DonghuaWorld provider for Nuvio (QuickJS: no DOM / Node APIs).
// Flow: TMDB title -> search donghuaworld.com -> series page (/anime/slug/)
//       -> episode page -> Dailymotion embed -> HLS master -> quality list.

const BASE = "https://donghuaworld.com";
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
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((val >> bits) & 0xff); }
  }
  return out;
}

const norm = (s) =>
  String(s || "").toLowerCase().replace(/&#8217;|&#039;|&amp;|’|'/g, "")
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
  const j = await (await fetch(
    `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}`
  )).json();
  return [j.name || j.title, j.original_name || j.original_title].filter(Boolean);
}

// ---------- site ----------
async function search(query) {
  const html = await getText(`${BASE}/?s=${encodeURIComponent(query)}`);
  const results = [], seen = {};
  const re = /<a[^>]+href="(https:\/\/donghuaworld\.com\/anime\/[^"#?]+\/)"[^>]*(?:title="([^"]*)")?/g;
  let m;
  while ((m = re.exec(html))) {
    if (seen[m[1]]) continue;
    seen[m[1]] = 1;
    const slugTitle = m[1].replace(/.*\/anime\/|\/$/g, "").replace(/-/g, " ");
    results.push({ url: m[1], title: m[2] || slugTitle, slugTitle });
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
    for (const r of await search(q)) {
      let score = Math.max(similarity(q, r.title), similarity(q, r.slugTitle));
      if (mediaType === "tv" && season > 1 && new RegExp(`season ${season}\\b`, "i").test(r.title + " " + r.slugTitle)) score += 0.3;
      if (!best || score > best.score) best = Object.assign({ score }, r);
    }
    if (best && best.score >= 0.8) break;
  }
  return best && best.score >= 0.5 ? best : null;
}

// Episode slugs look like: {name}-episode-16-4k-multi-subtitles
// Batch posts exist too: ...-episode-34-36-multi-subtitles
async function findEpisodeUrl(seriesUrl, episode) {
  const html = await getText(seriesUrl);
  const re = /href="(https:\/\/donghuaworld\.com\/[^"\/]*-episode-(\d+)(?:-(\d+))?(?:-4k)?-multi-subtitles\/)"/g;
  let m, exact = null, ranged = null;
  while ((m = re.exec(html))) {
    const a = parseInt(m[2], 10), b = m[3] ? parseInt(m[3], 10) : a;
    if (a === Number(episode) && !m[3]) exact = exact || m[1];
    else if (Number(episode) >= a && Number(episode) <= b) ranged = ranged || m[1];
  }
  return exact || ranged;
}

async function findMovieUrl(seriesUrl) {
  const html = await getText(seriesUrl);
  const m = /href="(https:\/\/donghuaworld\.com\/[^"\/]+-multi-subtitles\/)"/.exec(html);
  return m ? m[1] : seriesUrl;
}

function extractEmbeds(html) {
  const found = {}, out = [];
  const add = (u) => { u = u.replace(/&amp;/g, "&").replace(/^\/\//, "https://"); if (!found[u]) { found[u] = 1; out.push(u); } };
  let m;
  const dm = /https?:\/\/geo\.dailymotion\.com\/player\/\w+\.html\?video=[\w]+/g;
  while ((m = dm.exec(html))) add(m[0]);
  const dm2 = /https?:\/\/(?:www\.)?dailymotion\.com\/(?:embed\/)?video\/[\w]+/g;
  while ((m = dm2.exec(html))) add(m[0]);
  // base64 <option value="..."> servers (same theme family as other sites)
  const opt = /<option[^>]*value="([A-Za-z0-9+/=]{24,})"/g;
  while ((m = opt.exec(html))) {
    const d = b64decode(m[1]);
    const f = /<iframe[^>]+src=["']([^"']+)["']/i.exec(d);
    if (f) add(f[1]);
  }
  return out;
}

// ---------- quality handling ----------
function qualityLabel(h) {
  if (h >= 2000) return "2160p (4K)";
  if (h >= 1400) return "1440p";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h >= 460) return "480p";
  if (h >= 340) return "360p";
  return h + "p";
}

function absUrl(base, rel) {
  if (/^https?:/i.test(rel)) return rel;
  if (rel[0] === "/") return base.replace(/^(https?:\/\/[^\/]+).*/, "$1") + rel;
  return base.replace(/[^\/]*$/, "") + rel;
}

async function expandHls(masterUrl, hdrs) {
  const out = [{ url: masterUrl, quality: "Auto", height: 0, master: true }];
  try {
    const txt = await getText(masterUrl, hdrs);
    const lines = txt.split(/\r?\n/);
    const hasSeparateAudio = /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/.test(txt);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
      const next = (lines[i + 1] || "").trim();
      if (res && next && next[0] !== "#") {
        variants.push({ url: absUrl(masterUrl, next), height: parseInt(res[2], 10) });
      }
    }
    if (variants.length) {
      const max = Math.max.apply(null, variants.map((v) => v.height));
      out[0].quality = "Auto (up to " + qualityLabel(max) + ")";
      out[0].height = max;
      // Separate audio tracks would be lost on a bare variant URL, so only
      // offer per-quality links when audio is muxed into the variants.
      if (!hasSeparateAudio) {
        const seen = {};
        variants.forEach((v) => {
          if (seen[v.height]) return;
          seen[v.height] = 1;
          out.push({ url: v.url, quality: qualityLabel(v.height), height: v.height });
        });
      }
    }
  } catch (e) {}
  return out;
}

async function resolveDailymotion(url) {
  const id = (/[?&]video=([^&]+)/.exec(url) || /\/video\/([^?_\/]+)/.exec(url) || [])[1];
  if (!id) return [];
  const j = await (await fetch(`https://www.dailymotion.com/player/metadata/video/${id}`, { headers: UA })).json();
  const auto = j && j.qualities && j.qualities.auto && j.qualities.auto[0];
  if (!auto) return [];
  return await expandHls(auto.url, UA);
}

async function resolve(embed) {
  try {
    if (/dailymotion\.com/.test(embed)) return await resolveDailymotion(embed);
  } catch (e) {}
  return [];
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  const fail = (m) => [{ name: "DonghuaWorld DEBUG", title: dbg.concat(m).join(" > "), url: "https://debug.invalid/", quality: "debug" }];
  try {
    const titles = await getTitles(tmdbId, mediaType);
    dbg.push("titles=" + titles.join("|"));
    if (!titles.length) return fail("no titles");
    const series = await findSeries(titles, mediaType, Number(season) || 1);
    dbg.push("series=" + (series ? series.url : "none"));
    if (!series) return fail("series not found");

    const pageUrl = mediaType === "tv"
      ? await findEpisodeUrl(series.url, episode || 1)
      : await findMovieUrl(series.url);
    dbg.push("page=" + pageUrl);
    if (!pageUrl) return fail("episode not found");

    const embeds = extractEmbeds(await getText(pageUrl));
    dbg.push("embeds=" + embeds.length);
    const is4kPage = /-4k-/.test(pageUrl);
    const streams = [];
    for (const e of embeds) {
      const links = await resolve(e);
      links.sort((a, b) => b.height - a.height);
      links.forEach((l) =>
        streams.push({
          name: "DonghuaWorld",
          title: "Dailymotion" + (is4kPage ? " [4K source]" : ""),
          url: l.url,
          quality: l.quality,
          headers: UA,
          provider: "donghuaworld",
        })
      );
    }
    return streams.length ? streams : fail("no playable streams");
  } catch (err) {
    return fail("ERROR " + (err && err.message));
  }
}

module.exports = { getStreams };
