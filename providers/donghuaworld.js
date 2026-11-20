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
  const add = (u) => {
    u = String(u).replace(/&amp;/g, "&").replace(/\\\//g, "/").replace(/^\/\//, "https://");
    if (!/^https?:\/\//i.test(u)) return;
    if (/(histats|google|facebook|twitter|t\.me|whatsapp|gravatar|wp-content|wp-json|disqus)/i.test(u)) return;
    if (!found[u]) { found[u] = 1; out.push(u); }
  };
  let m;
  const dm = /https?:\/\/geo\.dailymotion\.com\/player\/\w+\.html\?video=[\w]+/g;
  while ((m = dm.exec(html))) add(m[0]);
  const dm2 = /https?:\/\/(?:www\.)?dailymotion\.com\/(?:embed\/)?video\/[\w]+/g;
  while ((m = dm2.exec(html))) add(m[0]);

  // every iframe / lazy iframe
  const ifr = /<iframe[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi;
  while ((m = ifr.exec(html))) add(m[1]);

  // base64 payloads in value= / data-*= attributes (server selectors)
  const attr = /(?:value|data-[\w-]+)=["']([A-Za-z0-9+/=]{24,})["']/g;
  while ((m = attr.exec(html))) {
    const d = b64decode(m[1]);
    const f = /<iframe[^>]+src=["']([^"']+)["']/i.exec(d);
    if (f) add(f[1]);
    else if (/^https?:\/\//i.test(d.trim())) add(d.trim());
  }
  // plain URLs in data-* attributes of server buttons
  const du = /data-(?:src|url|embed|link|video|server)[\w-]*=["'](https?:\/\/[^"']+)["']/gi;
  while ((m = du.exec(html))) add(m[1]);
  // direct playlists anywhere in the page
  const pl = /https?:\\?\/\\?\/[^"'\s<>\\]+?\.m3u8[^"'\s<>\\]*/g;
  while ((m = pl.exec(html))) add(m[0]);
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
    if (txt.indexOf("#EXTM3U") !== 0) DIAG.push("master?" + txt.length + ":" + txt.slice(0, 30).replace(/\s+/g, " "));
    const lines = txt.split(/\r?\n/);
    const byHeight = {};
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      let next = "";
      for (let k = i + 1; k < lines.length; k++) {
        const t = lines[k].trim();
        if (t && t[0] !== "#") { next = t; break; }
      }
      if (!next) continue;
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      const nm = /NAME="?(\d{3,4})p?"?/.exec(line);
      const hRaw = res ? parseInt(res[2], 10) : nm ? parseInt(nm[1], 10) : 0;
      const wRaw = res ? parseInt(res[1], 10) : 0;
      // scope/letterboxed video (e.g. 1280x544) is really the 720p tier
      const h = Math.max(hRaw, Math.round((wRaw * 9) / 16));
      if (!h) continue;
      const bw = parseInt((/(?:^|[,:])BANDWIDTH=(\d+)/.exec(line) || [0, 0])[1], 10);
      const avc = /avc1/i.test(line);
      const cur = byHeight[h];
      // one entry per quality; prefer H.264 (plays everywhere), then bitrate
      if (!cur || (avc && !cur.avc) || (avc === cur.avc && bw > cur.bw)) {
        byHeight[h] = { url: absUrl(masterUrl, next), height: h, bw: bw, avc: avc };
      }
    }
    const hs = Object.keys(byHeight).map(Number).sort((x, y) => y - x);
    if (hs.length) {
      out[0].quality = "Auto (up to " + qualityLabel(hs[0]) + ")";
      out[0].height = hs[0];
      hs.forEach((h) => out.push({ url: byHeight[h].url, quality: qualityLabel(h), height: h }));
    }
  } catch (e) {}
  return out;
}

const DIAG = [];

async function fetchJsonSafe(u, h) {
  try {
    const r = await fetch(u, { headers: h });
    const t = await r.text();
    const j = JSON.parse(t);
    return j && j.qualities ? j : null;
  } catch (e) { return null; }
}

function randHex(n) {
  let s = "";
  while (s.length < n) s += Math.floor(Math.random() * 16).toString(16);
  return s.toUpperCase();
}

// Build the list of playable links from one metadata response.
async function linksFromMeta(j, H) {
  const q = j.qualities, out = [], seenH = {};
  try {
    Object.keys(q).forEach((k) => {
      if (!/^\d+$/.test(k)) return;
      (q[k] || []).forEach((it) => {
        if (!it || !it.url || it.type === "application/x-mpegURL") return;
        const h = parseInt(k, 10);
        if (seenH[h]) return;
        seenH[h] = 1;
        out.push({ url: it.url, quality: qualityLabel(h), height: h });
      });
    });
  } catch (e) {}
  const auto = q.auto && q.auto[0];
  if (auto && auto.url) {
    let hls = await expandHls(auto.url, UA);
    if (hls.length === 1) hls = await expandHls(auto.url, H);
    hls.forEach((l) => { if (l.master || !seenH[l.height]) out.push(l); });
  }
  return out;
}

const maxH = (links) => links.reduce((m, l) => Math.max(m, l.height || 0), 0);

async function resolveDailymotion(url, pageUrl) {
  const id = (/[?&]video=([^&]+)/.exec(url) || /\/video\/([^?_\/]+)/.exec(url) || [])[1];
  if (!id) return [];
  const playerId = (/\/player\/(\w+)\.html/.exec(url) || [])[1];
  const ref = pageUrl || BASE + "/";
  const v1 = randHex(32), ts = String(Math.floor(Math.random() * 90000) + 10000);
  const H = Object.assign({}, UA, { Referer: ref, Origin: BASE, Cookie: "v1st=" + v1 + "; ts=" + ts });
  const plain = `https://www.dailymotion.com/player/metadata/video/${id}`;

  // Same parameters the official embedded player sends. The player id and
  // the dmV1st/dmTs pair decide which qualities the server hands back.
  const full = plain + "?" + [
    "embedder=" + encodeURIComponent(ref),
    "geo=1",
    playerId ? "player-id=" + playerId : "",
    "locale=en-US",
    "dmV1st=" + v1,
    "dmTs=" + ts,
    "is_native_app=0",
  ].filter(Boolean).join("&");

  const attempts = [
    { name: "full", url: full, h: H },
    { name: "embedder", url: `${plain}?embedder=${encodeURIComponent(ref)}`, h: H },
    { name: "plain", url: plain, h: UA },
  ];
  let best = [], bestName = "";
  for (const at of attempts) {
    const j = await fetchJsonSafe(at.url, at.h);
    if (!j) { DIAG.push(at.name + ":fail"); continue; }
    const links = await linksFromMeta(j, at.h);
    const hs = links.map((l) => l.height).filter(Boolean).sort((x, y) => x - y);
    DIAG.push(at.name + ":" + (hs.join("/") || "auto"));
    if (maxH(links) > maxH(best) || (!best.length && links.length)) { best = links; bestName = at.name; }
    if (maxH(best) >= 2000) break;
  }
  // Some private embeds (video=k...) map to a public id (x...); ask for that too.
  if (maxH(best) < 1000) {
    try {
      const j0 = await fetchJsonSafe(full, H);
      const xid = j0 && (j0.id || j0.video_id);
      if (xid && xid !== id) {
        const j = await fetchJsonSafe(`https://www.dailymotion.com/player/metadata/video/${xid}?embedder=${encodeURIComponent(ref)}&dmV1st=${v1}&dmTs=${ts}`, H);
        if (j) {
          const links = await linksFromMeta(j, H);
          DIAG.push("xid:" + (links.map((l) => l.height).filter(Boolean).sort((x, y) => x - y).join("/") || "auto"));
          if (maxH(links) > maxH(best)) { best = links; bestName = "xid"; }
        }
      }
    } catch (e) {}
  }
  best.forEach((o) => { o.info = bestName; });
  return best;
}

function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(u);
  return m ? m[1] : u;
}

// Best-effort for non-Dailymotion players: fetch the player page and look
// for HLS playlists in it.
async function resolveGeneric(embed, pageUrl) {
  const origin = "https://" + hostOf(embed);
  const H = Object.assign({}, UA, { Referer: pageUrl || BASE + "/" });
  const html = (await getText(embed, H)).replace(/\\\//g, "/");
  const urls = [], seen = {};
  let m;
  const re = /https?:\/\/[^"'\s<>\\]+?\.m3u8[^"'\s<>\\]*/g;
  while ((m = re.exec(html))) {
    const u = m[0].replace(/&amp;/g, "&");
    if (!seen[u]) { seen[u] = 1; urls.push(u); }
  }
  DIAG.push("gen " + embed.slice(0, 110) + " len=" + html.length + " m3u8=" + urls.length);
  const PH = Object.assign({}, UA, { Referer: embed, Origin: origin });
  const out = [];
  for (const u of urls.slice(0, 3)) {
    const hls = await expandHls(u, PH);
    hls.forEach((l) => { l.hdrs = PH; l.host = hostOf(embed); out.push(l); });
  }
  return out;
}

async function resolve(embed, pageUrl) {
  try {
    if (/dailymotion\.com/.test(embed)) return await resolveDailymotion(embed, pageUrl);
    return await resolveGeneric(embed, pageUrl);
  } catch (e) {}
  return [];
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  DIAG.length = 0;
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
    DIAG.push("embeds[" + embeds.map(hostOf).join(",") + "]");
    const is4kPage = /-4k-/.test(pageUrl);
    const streams = [];
    for (const e of embeds) {
      const links = await resolve(e, pageUrl);
      links.sort((a, b) => b.height - a.height);
      links.forEach((l) =>
        streams.push({
          name: "DonghuaWorld",
          title: (l.host || "Dailymotion") + (is4kPage ? " [4K source]" : "") + (l.info ? " (" + l.info + ")" : ""),
          url: l.url,
          quality: l.quality,
          headers: l.hdrs || UA,
          provider: "donghuaworld",
        })
      );
    }
    if (!streams.length) return [{ name: "DEBUG " + DIAG.join(" | ").slice(0, 700), title: dbg.concat("no playable streams").join(" > "), url: "https://debug.invalid/", quality: "debug" }];
    streams.push({ name: "INFO " + DIAG.join(" | ").slice(0, 700), title: DIAG.join(" | ").slice(0, 700), url: "https://debug.invalid/", quality: "info" });
    return streams;
  } catch (err) {
    return fail("ERROR " + (err && err.message));
  }
}

module.exports = { getStreams };
