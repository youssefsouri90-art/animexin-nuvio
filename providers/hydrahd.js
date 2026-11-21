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

function desc(o) {
  if (o == null) return String(o);
  const k = [];
  try { Object.getOwnPropertyNames(o).forEach((n) => k.push(n)); } catch (e) {}
  try { for (const n in o) if (k.indexOf(n) < 0) k.push(n + "*"); } catch (e) {}
  try {
    const p = Object.getPrototypeOf(o);
    if (p && p !== Object.prototype) Object.getOwnPropertyNames(p).forEach((n) => k.push("p." + n));
  } catch (e) {}
  return k.slice(0, 14).join("|");
}

async function getBytes(res) {
  const has = [];
  ["arrayBuffer", "bytes", "blob"].forEach((k) => {
    has.push(k + ":" + typeof res[k]);
  });
  has.push("body:" + typeof res.body);
  DIAG.push("resp{" + has.join(",") + "}");
  if (typeof res.arrayBuffer === "function") {
    return new Uint8Array(await res.arrayBuffer());
  }
  if (typeof res.bytes === "function") {
    return new Uint8Array(await res.bytes());
  }
  if (typeof res.blob === "function") {
    const b = await res.blob();
    if (b && typeof b.arrayBuffer === "function") {
      return new Uint8Array(await b.arrayBuffer());
    }
  }
  if (res.body && typeof res.body.getReader === "function") {
    const rd = res.body.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const x = await rd.read();
      if (x.done) break;
      parts.push(x.value);
      total += x.value.length;
    }
    const out = new Uint8Array(total);
    let o = 0;
    parts.forEach((c) => { out.set(c, o); o += c.length; });
    return out;
  }
  throw new Error("no binary read");
}

async function decryptUrls(encB64, wasmUrl, referer) {
  if (typeof WebAssembly === "undefined") throw new Error("no WebAssembly");
  const res = await fetch(wasmUrl, {
    headers: { "User-Agent": UA, Referer: referer },
  });
  DIAG.push("wasm-http" + res.status);
  const bytes = await getBytes(res);
  DIAG.push("bytes" + bytes.length);
  DIAG.push("WA{" + ["compile","instantiate","Module","Instance","Memory"].map((k) => k + ":" + typeof WebAssembly[k]).join(",") + "}");
  let ex = null;
  const tries = [];
  if (typeof WebAssembly.Module === "function" && typeof WebAssembly.Instance === "function") {
    tries.push(async () => new WebAssembly.Instance(new WebAssembly.Module(bytes), {}));
  }
  if (typeof WebAssembly.compile === "function") {
    tries.push(async () => WebAssembly.instantiate(await WebAssembly.compile(bytes), {}));
  }
  tries.push(async () => {
    const r = await WebAssembly.instantiate(bytes, {});
    DIAG.push("r:" + typeof r + "{" + desc(r) + "}");
    if (r && r.instance) DIAG.push("inst{" + desc(r.instance) + "} exp{" + desc(r.instance.exports) + "}");
    if (r && r.exports) DIAG.push("rexp{" + desc(r.exports) + "}");
    return r && r.instance ? r.instance : r;
  });
  for (let i = 0; i < tries.length; i++) {
    try {
      const inst = await tries[i]();
      const e = (inst && inst.exports) || inst;
      const names = e ? Object.getOwnPropertyNames(e) : [];
      DIAG.push("try" + i + ":names=" + names.join("|") + ",alloc=" + typeof (e && e.alloc) + ",dec=" + typeof (e && e.decrypt) + ",mem=" + typeof (e && e.memory));
      if (e && typeof e.alloc === "function" && typeof e.decrypt === "function") { ex = e; break; }
    } catch (err) {
      DIAG.push("try" + i + ":err=" + String((err && err.message) || err).slice(0, 40));
    }
  }
  if (!ex) throw new Error("no usable exports");
  const enc = b64(encB64);
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const n = ex.decrypt(ptr, enc.length);
  DIAG.push("dec" + n);
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
    { name: "YTHD v5: " + msg, title: msg, url: "https://debug.invalid/ythd/1", quality: "debug" },
    { name: "YTHD v5 steps: " + (DIAG.join(">") || "none"), title: "steps", url: "https://debug.invalid/ythd/2", quality: "debug" },
    { name: "YTHD v5 env: " + env, title: "env", url: "https://debug.invalid/ythd/3", quality: "debug" },
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
      provider: "ythd5",
    }));
  } catch (e) {
    return fail("ERROR " + String((e && e.message) || e).slice(0, 100));
  }
}

module.exports = { getStreams, DIAG };
