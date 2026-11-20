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
