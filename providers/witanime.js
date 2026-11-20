// WitAnime fast diagnostic build for Nuvio (max ~12s)
const BASE = "https://witanime.site";
const TMDB_KEY = "4d15cca3b68f75e9a08080dbe6a0568b";

const UA_STR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const LANG = "ar,en-US;q=0.9,en;q=0.8";
const DIAG = [];
let JAR = {};

const sleep = (ms) => new Promise((r) => (typeof setTimeout === "function" ? setTimeout(r, ms) : r()));

function withTimeout(promise, ms, label) {
  let tid = null;
  const timeout = new Promise((_, reject) => {
    if (typeof setTimeout === "function") {
      tid = setTimeout(() => reject(new Error("timeout:" + label)), ms);
    }
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (tid && typeof clearTimeout === "function") {
      try { clearTimeout(tid); } catch (e) {}
    }
  });
}

function jarHeader() {
  const k = Object.keys(JAR);
  return k.length ? k.map((n) => n + "=" + JAR[n]).join("; ") : "";
}
function jarAdd(list) {
  (list || []).forEach((c) => {
    const m = /^\s*([^=;\s]+)=([^;]*)/.exec(String(c || ""));
    if (m) JAR[m[1]] = m[2];
  });
}
function jarUpdate(res) {
  try {
    if (!res || !res.headers) return;
    if (typeof res.headers.getSetCookie === "function") return jarAdd(res.headers.getSetCookie());
    const sc = typeof res.headers.get === "function" ? res.headers.get("set-cookie") : res.headers["set-cookie"];
    if (sc) jarAdd(Array.isArray(sc) ? sc : String(sc).split(/,(?=\s*[A-Za-z0-9_.\-]+=)/));
  } catch (e) {}
}

async function reqFast(url, opts, ms, label) {
  const own = String(url).indexOf(BASE) === 0;
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({}, o.headers || {});
  const ck = own ? jarHeader() : "";
  if (ck) o.headers["Cookie"] = ck;
  const r = await withTimeout(fetch(url, o), ms || 6000, label || "net");
  if (own) jarUpdate(r);
  return r;
}

function pageHeaders(referer) {
  const h = {
    "User-Agent": UA_STR,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": LANG,
  };
  if (referer) h.Referer = referer;
  return h;
}

const slugify = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/&#?\w+;/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function getStreams(tmdbId, mediaType, season, episode) {
  DIAG.length = 0;
  JAR = {};
  const diagItem = (msg) => [
    {
      name: "WitAnime DIAG",
      quality: "debug",
      title: msg + " | " + DIAG.join(" > "),
      url: BASE + "/",
    },
  ];

  const run = async () => {
    DIAG.push("start:" + tmdbId + ":" + mediaType + ":s" + season + "e" + episode);

    let titles = [];
    if (String(tmdbId).indexOf("slug:") === 0) {
      titles = [String(tmdbId).slice(5)];
    } else {
      try {
        const type = mediaType === "movie" ? "movie" : "tv";
        const r = await reqFast(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`, {}, 5000, "tmdb");
        const j = await r.json();
        const t = j && (j.name || j.title || j.original_name || j.original_title);
        if (t) titles.push(t);
        DIAG.push("tmdb:" + (t || "empty"));
      } catch (e) {
        DIAG.push("tmdb:" + e.message);
      }
    }

    const slug = slugify(titles[0] || "one-piece") || "one-piece";
    const watchUrl = mediaType === "movie" ? `${BASE}/watch/movie/${slug}` : `${BASE}/watch/${slug}/${episode || 1}`;
    let html = "";
    try {
      const r = await reqFast(watchUrl, { headers: pageHeaders(BASE + "/") }, 6000, "watch");
      html = await withTimeout(r.text(), 4000, "watch_txt");
      DIAG.push("watch:" + r.status + ":len" + html.length);
    } catch (e) {
      DIAG.push("watch:" + e.message);
      return diagItem("watch_fail");
    }

    const cm = /name="csrf-token"\s+content="([^"]+)"/i.exec(html);
    const csrf = cm ? cm[1] : "";
    if (!csrf) {
      DIAG.push("no_csrf");
      return diagItem("no_csrf");
    }

    try {
      const sr = await reqFast(
        watchUrl + "/sources",
        {
          method: "POST",
          headers: {
            "User-Agent": UA_STR,
            Accept: "application/json",
            "Accept-Language": LANG,
            "X-CSRF-TOKEN": csrf,
            Origin: BASE,
            Referer: watchUrl,
            "X-Requested-With": "XMLHttpRequest",
          },
          body: "",
        },
        6000,
        "sources"
      );
      const stxt = await withTimeout(sr.text(), 4000, "sources_txt");
      DIAG.push("sources:" + sr.status + ":len" + stxt.length);
      return diagItem("done_sources");
    } catch (e) {
      DIAG.push("sources:" + e.message);
      return diagItem("sources_fail");
    }
  };

  try {
    return await withTimeout(run(), 12000, "total_12s");
  } catch (e) {
    DIAG.push("top:" + e.message);
    return diagItem("timed_out");
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else if (typeof globalThis !== "undefined") globalThis.getStreams = getStreams;
