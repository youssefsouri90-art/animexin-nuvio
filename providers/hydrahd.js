// YTHD provider for Nuvio (movies only for now). Test version.
// Chain: ythd wrapper -> vs_src.php -> inner embed -> player page -> data API
// -> decrypt stream_urls with the site's own WASM decryptor.

const UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const DIAG = [];

async function get(url, headers) {
  const r = await fetch(url, {
    headers: Object.assign({ "User-Agent": UA }, headers || {}),
  });
  const t = await r.text();
  if (!r.ok) DIAG.push("http" + r.status + ":" + url.slice(0, 50));
  return { s: r.status, t };
}

function unesc(s) {
  return String(s).replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}

function b64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function utf8(bytes) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s; // URLs are plain ASCII
}

async function decryptUrls(encB64, wasmUrl, referer) {
  if (typeof WebAssembly === "undefined") throw new Error("no WebAssembly");
  const res = await fetch(wasmUrl, {
    headers: { "User-Agent": UA, Referer: referer },
  });
  const bytes = await res.arrayBuffer();
  let inst;
  if (WebAssembly.compile) {
    inst = await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
  } else {
    inst = (await WebAssembly.instantiate(bytes, {})).instance;
  }
  const ex = inst.exports;
  const enc = b64(encB64);
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const n = ex.decrypt(ptr, enc.length);
  return utf8(new Uint8Array(ex.memory.buffer, ptr + 12, n))
    .split("\n")
    .filter(Boolean);
}

function fail(msg) {
  const env =
    "WA:" + typeof WebAssembly +
    " atob:" + typeof atob +
    " TD:" + typeof TextDecoder +
    " U8:" + typeof Uint8Array;
  return [
    { name: "YTHD: " + msg, title: msg, url: "https://debug.invalid/ythd/1", quality: "debug" },
    { name: "YTHD steps: " + (DIAG.join(">") || "none"), title: "steps", url: "https://debug.invalid/ythd/2", quality: "debug" },
    { name: "YTHD env: " + env, title: "env", url: "https://debug.invalid/ythd/3", quality: "debug" },
  ];
}

async function getStreams(tmdbId, mediaType) {
  DIAG.length = 0;
  try {
    if (mediaType !== "movie") return fail("tv not supported yet");
    const id = encodeURIComponent(String(tmdbId));
    const wrap = `https://ythd.org/embed/${id}/`;

    const a = await get(`https://ythd.org/vs_src.php?type=movie&id=${id}`, { Referer: wrap });
    let inner;
    try { inner = JSON.parse(a.t).src; } catch (e) { return fail("no inner src"); }
    if (!inner) return fail("no inner src");
    DIAG.push("inner");

    const ip = await get(inner, { Referer: wrap });
    const pm = /"playerUrl":"([^"]+)"/.exec(ip.t);
    if (!pm) return fail("no playerUrl");
    const base = inner.replace(/^(https?:\/\/[^\/]+).*$/, "$1");
    const playerUrl = unesc(pm[1]);
    const player = /^https?:/i.test(playerUrl) ? playerUrl : base + playerUrl;

    const pp = await get(player, { Referer: inner });
    const tm = /"apiToken"\s*:\s*"([^"]+)"/.exec(pp.t);
    const am = /"api"\s*:\s*"([^"]+)"/.exec(pp.t);
    if (!tm || !am) return fail("no api/token");
    DIAG.push("player");
    const origin = player.replace(/^(https?:\/\/[^\/]+).*$/, "$1");

    const api = unesc(am[1]) + "&api_token=" + encodeURIComponent(tm[1]);
    const jr = await get(api, { Referer: player, Origin: origin, Accept: "application/json" });
    let j;
    try { j = JSON.parse(jr.t); } catch (e) { return fail("api not json"); }
    if (!j || !j.data) return fail("api no data");
    DIAG.push("api");

    let urls = j.data.stream_urls;
    if (typeof urls === "string") {
      if (!j.vs || !j.vs.wasm_url) return fail("no wasm_url");
      urls = await decryptUrls(urls, j.vs.wasm_url, player);
    }
    DIAG.push("decrypt");
    if (!urls || !urls.length) return fail("no urls");

    const file = String(j.data.file_name || "");
    const q = (/(\d{3,4})p/i.exec(file) || [])[1];
    return urls.map((u, i) => ({
      name: "YTHD",
      title: "Server " + (i + 1) + (file ? " - " + file : ""),
      url: u,
      quality: q ? q + "p" : "HD",
      headers: { "User-Agent": UA, Referer: player },
      provider: "ythd",
    }));
  } catch (e) {
    return fail("ERROR " + String((e && e.message) || e).slice(0, 100));
  }
}

module.exports = { getStreams, DIAG };
