const LOCAL_API = "http://127.0.0.1:8787";

function slugifyTitle(title = "") {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getStreams(id, type, season, episode) {
  const epNum = episode || season || "1";
  const slug = slugifyTitle(id);
  const endpoint = `${LOCAL_API}/nuvio?slug=${encodeURIComponent(slug)}&ep=${encodeURIComponent(epNum)}`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    throw new Error(`Local server error: ${res.status}`);
  }

  const data = await res.json();
  return Array.isArray(data.streams) ? data.streams : [];
}
