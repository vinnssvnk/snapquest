// Draws the scanned board as an SVG hex map (pointy-top, axial q/r like the scanner).

export const TERRAIN = {
  plains:   { name: "Plains",   fill: "#c9c06a", ink: "#8c8536" },
  forest:   { name: "Forest",   fill: "#2f6b46", ink: "#1d4a2f" },
  mountain: { name: "Mountain", fill: "#a3a7ad", ink: "#5d6168" },
  water:    { name: "River",    fill: "#3f86b8", ink: "#bfe0f2" },
  swamp:    { name: "Swamp",    fill: "#6b7a3a", ink: "#3c4520" },
  village:  { name: "Village",  fill: "#d9b98a", ink: "#7a4f2a" },
  ruins:    { name: "Ruins",    fill: "#a8846a", ink: "#5e4433" },
};

const S3 = Math.sqrt(3);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function hexDistance(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function corners(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function glyph(terrain, x, y, s) {
  const ink = TERRAIN[terrain]?.ink || "#000";
  const p = (pts) => pts.map(([a, b]) => `${(x + a * s).toFixed(1)},${(y + b * s).toFixed(1)}`).join(" ");
  switch (terrain) {
    case "plains":
      return [[-6, 3], [0, -3], [6, 3]].map(([dx, dy]) =>
        `<polyline points="${p([[dx - 2.4, dy + 2.4], [dx, dy - 2.4], [dx + 2.4, dy + 2.4]])}" fill="none" stroke="${ink}" stroke-width="${1.6 * s}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
    case "forest":
      return [[-4.5, 2.5], [4.5, 2.5], [0, -4.5]].map(([dx, dy]) =>
        `<circle cx="${x + dx * s}" cy="${y + dy * s}" r="${4.8 * s}" fill="#3f8a5a" stroke="${ink}" stroke-width="${1.2 * s}"/>`).join("");
    case "mountain":
      return `<polygon points="${p([[-11, 6], [-3.5, -6], [3.5, 6]])}" fill="${ink}"/>` +
             `<polygon points="${p([[-2.5, 6], [4.5, -8], [11, 6]])}" fill="#6e737a"/>` +
             `<polygon points="${p([[2.3, -4], [4.5, -8], [6.7, -4]])}" fill="#fff"/>`;
    case "water": {
      const wave = (dy) => {
        let d = "";
        for (let i = 0; i <= 20; i++) d += `${i ? "L" : "M"}${(x + (-10 + i) * s).toFixed(1)},${(y + (dy + 1.6 * Math.sin(i * 0.65)) * s).toFixed(1)}`;
        return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${1.6 * s}" stroke-linecap="round"/>`;
      };
      return wave(-3) + wave(3);
    }
    case "swamp":
      return `<line x1="${x - 8 * s}" y1="${y + 6 * s}" x2="${x + 8 * s}" y2="${y + 6 * s}" stroke="${ink}" stroke-width="${1.6 * s}" stroke-linecap="round"/>` +
        [[-5, 8], [0, 11], [5, 7]].map(([dx, h]) =>
          `<line x1="${x + dx * s}" y1="${y + 6 * s}" x2="${x + dx * s}" y2="${y + (6 - h) * s}" stroke="${ink}" stroke-width="${1.5 * s}" stroke-linecap="round"/>`).join("");
    case "village":
      return [[-4.5, 1], [5, 0.85]].map(([dx, k]) =>
        `<polygon points="${p([[dx - 4 * k, 6], [dx - 4 * k, 0], [dx, -4.5 * k], [dx + 4 * k, 0], [dx + 4 * k, 6]])}" fill="${ink}"/>`).join("");
    case "ruins":
      return [[-7, -1, 4, 8], [-1.5, 2, 4, 5], [4.5, -4, 4, 11]].map(([dx, dy, w, h]) =>
        `<rect x="${x + dx * s}" y="${y + dy * s}" width="${w * s}" height="${h * s}" rx="${s}" fill="${ink}"/>`).join("");
    default:
      return "";
  }
}

/**
 * board: [{id, label, terrain, q, r}]
 * opts: { party: "V-03", quest: "S-07", places: {label: name}, highlight: [labels] }
 */
export function boardSVG(board, opts = {}) {
  if (!board?.length) return `<p class="muted">No tiles scanned yet.</p>`;
  const R = 30;
  const pos = board.map((t) => ({ t, x: R * S3 * (t.q + t.r / 2), y: R * 1.5 * t.r }));
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const pad = R + 6;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad - 6;
  const w = Math.max(...xs) - minX + pad, h = Math.max(...ys) - minY + pad;
  const hl = new Set(opts.highlight || []);
  let tiles = "", marks = "", labels = "";
  for (const { t, x, y } of pos) {
    const fill = TERRAIN[t.terrain]?.fill || "#555";
    tiles += `<g><polygon points="${corners(x, y, R - 0.5)}" fill="${fill}" stroke="#0d1110" stroke-width="2.5"/>` +
      `<polygon points="${corners(x, y, R - 3.5)}" fill="none" stroke="#8fd3b6" stroke-width="1.6" opacity=".9"/>` +
      glyph(t.terrain, x, y - 2, 1) + `</g>`;
    if (t.label === opts.quest)
      marks += `<polygon points="${corners(x, y, R - 2)}" fill="none" stroke="#e8552b" stroke-width="4.5"/>`;
    if (hl.has(t.label))
      marks += `<polygon points="${corners(x, y, R - 2)}" fill="none" stroke="#f2b544" stroke-width="3.5" stroke-dasharray="6 4"/>`;
    if (t.label === opts.party)
      marks += `<g><circle cx="${x}" cy="${y - R + 8}" r="9" fill="#f2b544" stroke="#111615" stroke-width="2.5"/>` +
        `<circle cx="${x}" cy="${y - R + 8}" r="3" fill="#111615"/></g>`;
    const name = opts.places?.[t.label];
    if (name) labels += `<text x="${x}" y="${y + R * 0.62}" text-anchor="middle">${esc(name.length > 16 ? name.slice(0, 15) + "…" : name)}</text>`;
  }
  return `<svg class="board" viewBox="${minX.toFixed(0)} ${minY.toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}" role="img" aria-label="Map of ${board.length} tiles">${tiles}${marks}${labels}</svg>`;
}
