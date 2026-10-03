/* ==========================================================================
   seed-variables-csv.mjs
   Builds the congestion-variable data layer for Makati Mobility Intelligence.

   Run:  node tools/seed-variables-csv.mjs

   Inputs
     tools/variable-catalog.mjs  — one entry per recorded variable occurrence
                                   (category + variable from Traffic_Variables_Data_Sheet)
     index.html                  — source of truth for corridor geometry and
                                   bottleneck coordinates (never duplicated by hand)

   Outputs
     data/traffic_variables.csv  — authoritative data store (UTF-8, RFC4180)
     index.html                  — same CSV embedded between the CSV:SEED markers
                                   so the page still works from file://
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CATALOG, CAT_CODE } from './variable-catalog.mjs';

const HTML_PATH = 'index.html';
const CSV_PATH = 'data/traffic_variables.csv';
const LEVEL_BANDS = [['low', 39.999], ['moderate', 64.999], ['high', 84.999], ['severe', 100]];
export const levelOf = ci => LEVEL_BANDS.find(([, max]) => ci <= max)[0];

/* Column contract — keep in sync with CSV_COLUMNS in index.html */
const COLUMNS = [
  'variable_id', 'category', 'variable_name', 'effect', 'corridor', 'location_name',
  'lat', 'lng', 'hour_start', 'hour_end', 'day_type', 'congestion_level',
  'congestion_index', 'observed_value', 'unit', 'threshold', 'weight', 'confidence',
  'source', 'last_updated', 'notes'
];

/* ---------- read geometry out of the app so coordinates can never drift ---- */
const html = readFileSync(HTML_PATH, 'utf8');
function literal(name) {
  const at = html.indexOf('const ' + name + ' = ');
  if (at < 0) throw new Error('could not find const ' + name + ' in index.html');
  const open = html.slice(at).search(/[[{]/);
  const start = at + open, openCh = html[start], closeCh = openCh === '{' ? '}' : ']';
  let depth = 0, i = start, inStr = null, cleared = '';
  for (; i < html.length; i++) {
    const ch = html[i], prev = html[i - 1];
    if (inStr) { cleared += ch; if (ch === inStr && prev !== '\\') inStr = null; continue; }
    if (ch === '/' && html[i + 1] === '/') { i = html.indexOf('\n', i) - 1; continue; }
    if (ch === '/' && html[i + 1] === '*') { i = html.indexOf('*/', i) + 1; continue; }
    cleared += ch;
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeCh) { depth--; if (depth === 0) break; }
  }
  return new Function('return ' + cleared)();
}
const CORRIDORS = literal('CORRIDORS');
const BOTTLENECKS = literal('BOTTLENECKS');

/* ---------- placement resolution ---------------------------------------- */
const haversine = (a, b) => {
  const R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180;
  const t = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(t));
};
function alongPath(cid, fraction, pathIdx = 0) {
  const pts = CORRIDORS[cid].paths[pathIdx];
  if (!pts) throw new Error(`corridor ${cid} has no path ${pathIdx}`);
  const legs = pts.slice(1).map((p, i) => haversine(pts[i], p));
  const total = legs.reduce((a, b) => a + b, 0), target = fraction * total;
  let acc = 0;
  for (let i = 0; i < legs.length; i++) {
    if (acc + legs[i] >= target) {
      const t = (target - acc) / legs[i];
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    acc += legs[i];
  }
  return pts[pts.length - 1];
}
function resolve(place) {
  if (place[0] === 'bo') {
    const b = BOTTLENECKS.find(x => x.id === place[1]);
    if (!b) throw new Error('unknown bottleneck ' + place[1]);
    return { corridor: b.corridor, lat: b.lat, lng: b.lng };
  }
  if (place[0] === 'path') {
    const [lat, lng] = alongPath(place[1], place[2], place[3] || 0);
    return { corridor: place[1], lat, lng };
  }
  return { corridor: 'all', lat: place[1], lng: place[2] };
}

/* ---------- build rows -------------------------------------------------- */
const seq = {};
const rows = CATALOG.map((e, i) => {
  const { corridor, lat, lng } = resolve(e.place);
  const jitter = ((i * 7919) % 17 - 8) * 0.00003;
  const code = CAT_CODE[e.cat];
  seq[code] = (seq[code] || 0) + 1;
  const [hs, he] = e.hours;
  if (!(hs >= 0 && hs <= 23 && he >= 0 && he <= 23)) throw new Error('bad window on row ' + i);
  return {
    variable_id: `VAR-${code}-${String(seq[code]).padStart(2, '0')}`,
    category: e.cat, variable_name: e.v, effect: e.eff, corridor,
    location_name: e.loc, lat: (lat + jitter).toFixed(6), lng: (lng - jitter).toFixed(6),
    hour_start: hs, hour_end: he, day_type: e.day || 'weekday',
    congestion_level: levelOf(e.ci), congestion_index: e.ci,
    observed_value: e.value, unit: e.unit, threshold: e.threshold,
    weight: e.w, confidence: e.conf, source: e.src,
    last_updated: e.upd || '2026-09-28', notes: e.note || ''
  };
});

/* ---------- write ------------------------------------------------------- */
const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = [COLUMNS.join(',')]
  .concat(rows.map(r => COLUMNS.map(c => q(r[c])).join(',')))
  .join('\n') + '\n';

mkdirSync('data', { recursive: true });
writeFileSync(CSV_PATH, csv, 'utf8');

const marker = /<!-- CSV:SEED:BEGIN -->[\s\S]*?<!-- CSV:SEED:END -->/;
if (!marker.test(html)) throw new Error('CSV:SEED markers missing in index.html');
writeFileSync(HTML_PATH, html.replace(marker, '<!-- CSV:SEED:BEGIN -->\n' + csv + '<!-- CSV:SEED:END -->'), 'utf8');

/* ---------- report ------------------------------------------------------ */
const tally = (list, fn) => list.reduce((m, r) => (m[fn(r)] = (m[fn(r)] || 0) + 1, m), {});
const uniq = k => new Set(rows.map(r => r[k])).size;
console.log(`rows: ${rows.length} · variables: ${uniq('variable_name')} · categories: ${uniq('category')} · corridors: ${uniq('corridor')}`);
console.log('by category:', tally(rows, r => r.category));
console.log('by corridor:', tally(rows, r => r.corridor));
console.log('by level   :', tally(rows, r => r.congestion_level));
const wrapped = rows.filter(r => r.hour_end < r.hour_start).length;
console.log(`wrapped-window rows: ${wrapped} · decreasing rows: ${rows.filter(r => r.effect === 'decreases').length}`);
console.log(`wrote ${CSV_PATH} (${csv.length} bytes) and re-seeded index.html`);
