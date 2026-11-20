// Campaigns live on this phone (localStorage). The server keeps nothing.
const KEY = "snapquest.campaigns.v1";
let memory = {};
let storageBroken = false;

function readAll() {
  if (storageBroken) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    storageBroken = true;
    return memory;
  }
}

function writeAll(data) {
  memory = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    storageBroken = true;   // private mode / storage full: keep working in memory
    return false;
  }
}

export function listCampaigns() {
  return Object.values(readAll()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export function getCampaign(id) {
  return readAll()[id] || null;
}

export function saveCampaign(c) {
  const all = readAll();
  c.updated = Date.now();
  if (c.log && c.log.length > 400) c.log = c.log.slice(-400);
  all[c.id] = c;
  return writeAll(all);
}

export function deleteCampaign(id) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
