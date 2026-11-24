// Animexin provider for Nuvio (QuickJS runtime: no DOM, no Node APIs).
// Flow: TMDB title -> search animexin.dev -> episode page -> decode server
// <option> values (base64 iframe) -> keep ONLY the allowed servers
// (Dailymotion AX / Rumble AX / Dood AX) -> resolve -> quality list.
// + WeTV subtitles: fetched from a local Termux server (yt-dlp) and attached
//   to every stream as `subtitles`.

const BASE = "https://animexin.dev";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

// Local Termux server that returns WeTV subtitles (see wetv_server.py).
const SUBS_API = "http://127.0.0.1:8787";

// Site / TMDB / Rumble / Dood: mobile UA (works with the site).
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
};
// Dailymotion only: desktop UA (Dailymotion serves higher qualities to desktop).
const UA_DM = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

// Allowed servers, in priority order. Matched against the option label first,
// then against the iframe URL. Everything else is ignored.
const ALLOWED = [
  { key: "Dailymotion", label: /dailymotion/i, url: /dailymotion\.com/i },
  { key: "Rumble", label: /rumble/i, url: /rumble\.com/i },
  { key: "Dood", label: /dood/i, url: /dood|d000d|ds2play|dsvplay|d0o0d|do7go|vide0\.net/i },
];

const DIAG = [];

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

function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(u);
  return m ? m[1] : u;
}

function randHex(n) {
  let s = "";
  while (s.length < n) s += Math.floor(Math.random() * 16).toString(16);
  return s.toUpperCase();
}

function randAlnum(n) {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
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

// ---------- WeTV subtitles (local Termux server) ----------
// Never throws: on any failure returns [] so playback is not affected.
async function getSubtitles(tmdbId, episode) {
  try {
    const r = await fetch(
      `${SUBS_API}/subs?tmdb=${encodeURIComponent(tmdbId)}&ep=${encodeURIComponent(episode || 1)}`
    );
    const j = await r.json();
    if (!Array.isArray(j)) { DIAG.push("subs:bad"); return []; }
    DIAG.push("subs:" + j.length);
    // several field names, to cover whatever shape the host app reads
    return j.map((s) => ({
      url: s.url,
      lang: s.lang,
      language: s.lang,
      label: s.label,
      name: s.label,
    }));
  } catch (e) {
    DIAG.push("subs:err");
    return [];
  }
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
    if (src) servers.push({ label: m[2].trim(), url: src[1].replace(/&amp;/g, "&").replace(/^\/\//, "https://") });
  }
  // fallback: default iframe in the page
  if (!servers.length) {
    const f = /<iframe[^>]+src=["']([^"']+)["']/i.exec(html);
    if (f) servers.push({ label: "Default", url: f[1].replace(/&amp;/g, "&").replace(/^\/\//, "https://") });
  }
  return servers;
}

// Keep only Dailymotion / Rumble / Dood servers, ordered by ALLOWED priority.
function filterServers(servers) {
  const out = [], seen = {};
  servers.forEach((s) => {
    let idx = ALLOWED.findIndex((a) => a.label.test(s.label));
    if (idx < 0) idx = ALLOWED.findIndex((a) => a.url.test(s.url));
    if (idx < 0) return;
    if (seen[s.url]) return;
    seen[s.url] = 1;
    out.push(Object.assign({ prio: idx, kind: ALLOWED[idx].key }, s));
  });
  out.sort((a, b) => a.prio - b.prio);
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

    // Some HLS sources carry audio in a separate rendition playlist. A child
    // video playlist can then be silent when opened by itself. Keep the master
    // playlist (which references both tracks) instead of emitting such children.
    const externalAudioGroups = new Set();
    for (const line of lines) {
      if (!/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=AUDIO/i.test(line)) continue;
      const gid = /GROUP-ID="([^"]+)"/i.exec(line);
      const uri = /URI="([^"]+)"/i.exec(line);
      if (gid && uri) externalAudioGroups.add(gid[1]);
    }

    const byHeight = {};
    let usesExternalAudio = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      const audio = /(?:^|,)\s*AUDIO="([^"]+)"/i.exec(line);
      if (audio && externalAudioGroups.has(audio[1])) usesExternalAudio = true;
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
      if (usesExternalAudio) {
        DIAG.push("hls:external-audio-master-only");
      } else {
        hs.forEach((h) => out.push({ url: byHeight[h].url, quality: qualityLabel(h), height: h }));
      }
    }
  } catch (e) {}
  return out;
}

const maxH = (links) => links.reduce((m, l) => Math.max(m, l.height || 0), 0);

// ---------- Dailymotion ----------
async function fetchJsonSafe(u, h) {
  try {
    const r = await fetch(u, { headers: h });
    const t = await r.text();
    const j = JSON.parse(t);
    return j && j.qualities ? j : null;
  } catch (e) { return null; }
}

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
    let hls = await expandHls(auto.url, UA_DM);
    if (hls.length === 1) hls = await expandHls(auto.url, H);
    hls.forEach((l) => { if (l.master || !seenH[l.height]) out.push(l); });
  }
  return out;
}

async function resolveDailymotion(url, pageUrl) {
  const id = (/[?&]video=([^&]+)/.exec(url) || /\/video\/([^?_\/]+)/.exec(url) || [])[1];
  if (!id) return [];
  const playerId = (/\/player\/(\w+)\.html/.exec(url) || [])[1];
  const ref = pageUrl || BASE + "/";
  const v1 = randHex(32), ts = String(Math.floor(Math.random() * 90000) + 10000);
  const H = Object.assign({}, UA_DM, { Referer: ref, Origin: BASE, Cookie: "v1st=" + v1 + "; ts=" + ts });
  const plain = `https://www.dailymotion.com/player/metadata/video/${id}`;

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
    { name: "plain", url: plain, h: UA_DM },
  ];
  let best = [], bestName = "";
  for (const at of attempts) {
    const j = await fetchJsonSafe(at.url, at.h);
    if (!j) { DIAG.push("dm-" + at.name + ":fail"); continue; }
    const links = await linksFromMeta(j, at.h);
    const hs = links.map((l) => l.height).filter(Boolean).sort((x, y) => x - y);
    DIAG.push("dm-" + at.name + ":" + (hs.join("/") || "auto"));
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
          DIAG.push("dm-xid:" + (links.map((l) => l.height).filter(Boolean).sort((x, y) => x - y).join("/") || "auto"));
          if (maxH(links) > maxH(best)) { best = links; bestName = "xid"; }
        }
      }
    } catch (e) {}
  }
  best.forEach((o) => { o.info = bestName; o.hdrs = H; });
  return best;
}

// ---------- Rumble ----------
async function resolveRumble(url, pageUrl) {
  const id = (/\/embed\/([^/?]+)/.exec(url) || [])[1];
  if (!id) return [];
  const H = Object.assign({}, UA, { Referer: pageUrl || BASE + "/" });
  const txt = await getText(`https://rumble.com/embedJS/u3/?request=video&ver=2&v=${id}`, H);
  let j;
  try { j = JSON.parse(txt); } catch (e) { DIAG.push("rumble:badjson"); return []; }
  const PH = Object.assign({}, UA, { Referer: "https://rumble.com/" });
  const out = [], seen = {};
  const add = (u, h) => {
    if (!u || seen[u]) return;
    seen[u] = 1;
    out.push({ url: u, quality: qualityLabel(h), height: h, hdrs: PH });
  };
  // direct files per quality (mp4 / webm)
  [j.ua, j.u].forEach((root) => {
    if (!root) return;
    ["mp4", "webm"].forEach((fmt) => {
      const grp = root[fmt];
      if (!grp) return;
      Object.keys(grp).forEach((k) => {
        const it = grp[k];
        const h = (it && it.meta && it.meta.h) || parseInt(k, 10);
        if (h && it && it.url) add(it.url, h);
      });
    });
  });
  // HLS (both possible locations)
  const hlsUrl =
    (j.ua && j.ua.hls && j.ua.hls.auto && j.ua.hls.auto.url) ||
    (j.u && j.u.hls && j.u.hls.auto && j.u.hls.auto.url);
  if (hlsUrl) {
    const list = await expandHls(hlsUrl, PH);
    list.forEach((l) => { if (!seen[l.url]) { seen[l.url] = 1; l.hdrs = PH; out.push(l); } });
  }
  DIAG.push("rumble:" + (out.map((l) => l.height).filter(Boolean).sort((x, y) => x - y).join("/") || "none"));
  return out;
}

// ---------- Dood ----------
async function resolveDood(url, pageUrl) {
  // normalise /d/ID to /e/ID (embed page)
  let embed = url.replace(/\/d\//, "/e/");
  const r = await fetch(embed, { headers: Object.assign({}, UA, { Referer: pageUrl || BASE + "/" }) });
  const html = await r.text();
  const finalUrl = (r && r.url) || embed;
  const origin = "https://" + hostOf(finalUrl);
  const pm = /\/pass_md5\/([^'"\s]+)/.exec(html);
  if (!pm) { DIAG.push("dood:nopass len=" + html.length); return []; }
  const token = pm[1].split("/").pop();
  const PH = Object.assign({}, UA, { Referer: origin + "/" });
  const base = (await getText(origin + "/pass_md5/" + pm[1], Object.assign({}, UA, { Referer: finalUrl }))).trim();
  if (!/^https?:/i.test(base)) { DIAG.push("dood:badbase " + base.slice(0, 40)); return []; }
  const link = base + randAlnum(10) + "?token=" + token + "&expiry=" + Date.now();
  DIAG.push("dood:ok");
  // Dood does not expose the resolution in the page; label as Direct
  return [{ url: link, quality: "Direct", height: 0, hdrs: PH }];
}

async function resolve(server, pageUrl) {
  const u = server.url;
  try {
    if (server.kind === "Dailymotion") return await resolveDailymotion(u, pageUrl);
    if (server.kind === "Rumble") return await resolveRumble(u, pageUrl);
    if (server.kind === "Dood") return await resolveDood(u, pageUrl);
  } catch (e) { DIAG.push(server.kind + " err " + (e && e.message)); }
  return [];
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  DIAG.length = 0;
  const fail = (m) => [{ name: "Animexin DEBUG", title: dbg.concat(m, DIAG).join(" > ").slice(0, 1200), url: "https://debug.invalid/", quality: "debug" }];
  try {
    dbg.push("tmdb=" + tmdbId + " s=" + season + " e=" + episode);

    // Start fetching WeTV subtitles right away, in parallel with everything else.
    const subsP = mediaType === "tv" ? getSubtitles(tmdbId, episode) : Promise.resolve([]);

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

    const all = extractServers(await getText(pageUrl));
    const servers = filterServers(all);
    dbg.push("servers=" + all.length + " kept=" + servers.length + "[" + servers.map((s) => s.label).join(",") + "]");

    const results = await Promise.all(
      servers.map(async (s) => ({ s, links: await resolve(s, pageUrl) }))
    );
    const subs = await subsP;

    const streams = [];
    results.forEach(({ s, links }) => {
      links.sort((a, b) => b.height - a.height);
      links.forEach((l) =>
        streams.push({
          name: "Animexin",
          title: s.kind + (s.label ? " - " + s.label : "") + (l.info ? " (" + l.info + ")" : ""),
          url: l.url,
          quality: l.quality,
          headers: l.hdrs || UA,
          provider: "animexin",
          subtitles: subs,
        })
      );
    });
    return streams.length ? streams : fail("no playable streams");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams };
