// Writes web/src/geo/greece.json, the map the Overview and Reports draw: Greece, its neighbours as quiet context, and
// the centre of each region (src/geo.js), projected once so the app ships no map library.
// { width, height, greece: SVG path, neighbours: [SVG path], regions: { id: [x, y] } }
// Source: Natural Earth 1:50m (public domain) through the world-atlas package (ISC). Regenerate (scratch deps,
// never in package.json):
//   cd E:\Claude\tmp\geo-build && npm i d3-geo topojson-client world-atlas
//   node scripts/build-greece-map.mjs --deps E:\Claude\tmp\geo-build\node_modules
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--deps');
const deps = i > 0 ? process.argv[i + 1] : 'E:/Claude/tmp/geo-build/node_modules';
const require = createRequire(path.join(deps, 'noop.js'));
const load = (name) => import(pathToFileURL(require.resolve(name)).href);
const { geoConicConformal, geoPath } = await load('d3-geo');
const { feature } = await load('topojson-client');
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const { REGIONS } = createRequire(import.meta.url)(path.join(here, '..', 'src', 'geo.js'));

const WIDTH = 640;
const HEIGHT = 560;
const all = feature(topo, topo.objects.countries).features;
const greece = all.find((f) => f.id === '300');
const NEIGHBOURS = ['008', '807', '100', '792', '688', '196', '070', '499', '191', '642'];

// Lambert conformal conic on Greece's latitudes, fitted to Greece with room for the bubbles at the edges.
const projection = geoConicConformal().parallels([35, 41]).rotate([-24, 0])
  .fitExtent([[24, 24], [WIDTH - 24, HEIGHT - 24]], greece);
const draw = geoPath(projection).digits(1);
const r = (n) => Math.round(n * 10) / 10;

const out = {
  width: WIDTH,
  height: HEIGHT,
  greece: draw(greece),
  neighbours: all.filter((f) => NEIGHBOURS.includes(f.id)).map((f) => draw(f)).filter(Boolean),
  regions: Object.fromEntries(Object.entries(REGIONS).map(([id, g]) => [id, projection([g.lon, g.lat]).map(r)]))
};

const file = path.join(here, '..', 'web', 'src', 'geo', 'greece.json');
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out));
console.log('wrote', file, (JSON.stringify(out).length / 1024).toFixed(0) + ' KB');
