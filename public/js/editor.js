// The map editor (?edit=1, served as edit.html by server/mapedit.js): the real map, a fly camera, a palette of thumbnails you drag
// onto the map, pieces you drag around directly (or with a gizmo), undo, overlays and layout checks, Save straight to the map's
// layout file (only when the server runs with MAP_EDIT=1, from localhost) and Test play. Every change edits the layout entries
// (read by map.js), then applyLayout() rebuilds the map's exports in place and the world is built again from them, so what you see
// is what the game will play.
// Round 29 (drag and drop): the palette is a grid of thumbnails (each kit piece rendered once, gameplay points drawn as icons) by
// category; a tile dragged over the map shows a ghost of the piece snapped to the grid and to what's below, and drops it there. A
// placed piece drags across the map without the gizmo (its instance follows the pointer live), Q/E or the wheel turn it, Alt-drag
// duplicates. Gameplay points (spawns, flasks, runes, pads and their landing spot, props, the drawbridge, braziers) drag the same way.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as C from '../shared/constants.js';
import { buildWorld, loadModels, makePropMesh, spinners, kitModelMeshes, kitMaterial, tintGeometry } from './world.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const L = C.LAYOUT;                                  // the live layout (map.js's); edits change L.entries
// Round 22: more than one map. ?map=<id> opens that layout (map.js read the query); the selector reloads the page on another.
const MAP = C.ACTIVE_MAP.name;
{
  const sel = $('mapSel'), maps = Object.entries(C.MAPS).filter(([id, M]) => !M.server && (!M.hidden || id === MAP));
  for (const [id, M] of maps) { const o = document.createElement('option'); o.value = id; o.textContent = `${M.title} (${M.file})`; sel.appendChild(o); }
  sel.value = MAP;
  if (maps.length < 2) sel.style.display = 'none';
  sel.onchange = () => { if (dirty && !confirm('Unsaved changes will be lost. Switch map?')) { sel.value = MAP; return; } dirty = false; location.search = `?edit=1&map=${sel.value}`; };
}
const byId = (id) => L.entries.find(e => e.id === id);
const status = (text, cls = '') => { const s = $('status'); s.textContent = text; s.className = cls; };
const hint = (text) => { const h = $('hintbar'); h.style.display = text ? 'block' : 'none'; h.textContent = text || ''; };
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ------------------------------------------------------------ the world, rebuilt from the layout after each change
// GLTF files load once; each build gets fresh clones (world.js fits and places what it's given).
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), gltfCache = new Map();
const loader = {
  load(url, onLoad, onProgress, onError) {
    if (!gltfCache.has(url)) gltfCache.set(url, gltfLoader.loadAsync(url));
    gltfCache.get(url).then(g => onLoad({ ...g, scene: g.scene.clone(true) }), onError);
  },
  setMeshoptDecoder() { return this; },
};
const helpers = new THREE.Group();                   // overlays, markers, the selection, ghosts and the gizmo: moved into each new scene
let scene = null, building = null, again = false;
async function rebuild() {
  if (building) { again = true; return building; }
  building = (async () => {
    const s = new THREE.Scene();
    buildWorld(s);
    const first = !scene;
    if (first) { scene = s; s.add(helpers); }
    await loadModels(loader, s, { cameraGrid: false });
    if (!first) { scene = s; s.add(helpers); }
    indexInstances();
  })();
  await building;
  building = null;
  if (again) { again = false; return rebuild(); }
}
// entry id -> what draws it in the current build: [{ im, i }] instance slots of its kit model, or the objects tagged with its id
let drawnBy = new Map();
function indexInstances() {
  drawnBy = new Map();
  scene.traverse(o => {
    if (o.isInstancedMesh && o.userData.ids) { o.frustumCulled = false; o.userData.ids.forEach((id, i) => (drawnBy.get(id) || drawnBy.set(id, []).get(id)).push({ im: o, i })); }
    else if (o.userData.entryId) (drawnBy.get(o.userData.entryId) || drawnBy.set(o.userData.entryId, []).get(o.userData.entryId)).push({ obj: o, at: o.position.clone(), rotY: o.rotation.y });
  });
}

// ------------------------------------------------------------ camera: fly with the right button held, or top-down
const cam = { pos: new THREE.Vector3(0, 42, -50), yaw: 0, pitch: -0.62, top: false };
const keys = new Set();
let looking = false;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => { if (e.button === 2) { looking = true; canvas.requestPointerLock?.(); } });
addEventListener('mouseup', e => { if (e.button === 2) { looking = false; document.exitPointerLock?.(); } });
addEventListener('mousemove', e => {
  if (!looking || cam.top) return;
  cam.yaw -= e.movementX * 0.003;
  cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - e.movementY * 0.003));
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (drag || ghost) { turnHeld(e.deltaY > 0 ? -1 : 1, e.shiftKey); return; }   // while dragging: the wheel turns what's held
  if (cam.top) { cam.pos.y = Math.max(15, Math.min(160, cam.pos.y * (1 + e.deltaY * 0.001))); return; }
  cam.pos.addScaledVector(camDir(), -e.deltaY * 0.03);
}, { passive: false });
function camDir() { return new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)); }
function toggleTop() {
  cam.top = !cam.top;
  if (cam.top) { cam.saved = { pos: cam.pos.clone(), yaw: cam.yaw, pitch: cam.pitch }; cam.pos.set(0, 80, -0.001); }   // the whole field
  else if (cam.saved) Object.assign(cam, { pos: cam.saved.pos, yaw: cam.saved.yaw, pitch: cam.saved.pitch });
  $('topBtn').classList.toggle('on', cam.top);
}
$('topBtn').onclick = toggleTop;
function moveCamera(dt) {
  if (!looking) return;
  const v = (keys.has('shift') ? 30 : 10) * dt, fwd = cam.top ? new THREE.Vector3(0, 0, -1) : camDir(), right = new THREE.Vector3(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw));
  if (cam.top) right.set(1, 0, 0);
  if (keys.has('w')) cam.pos.addScaledVector(fwd, v);
  if (keys.has('s')) cam.pos.addScaledVector(fwd, -v);
  if (keys.has('d')) cam.pos.addScaledVector(right, v);
  if (keys.has('a')) cam.pos.addScaledVector(right, -v);
  if (keys.has('e') && !cam.top) cam.pos.y += v;
  if (keys.has('q') && !cam.top) cam.pos.y = Math.max(0.5, cam.pos.y - v);
}
function placeCamera() {
  camera.position.copy(cam.pos);
  if (cam.top) { camera.up.set(0, 0, -1); camera.lookAt(cam.pos.x, 0, cam.pos.z); }
  else { camera.up.set(0, 1, 0); camera.lookAt(cam.pos.clone().add(camDir())); }
}

// ------------------------------------------------------------ where an entry is, and how big (for picking and highlights)
const RADIUS = { prop: 0.75, spawn: 1.2, heal: 1.1, rune: 1.0, pad: 1.1, portal: 1.1, brazier: 0.8, drawbridge: 2.4 };
const FLOOR_KINDS = ['prop', 'spawn', 'heal', 'rune', 'pad', 'portal', 'brazier'];   // stand on what's under them (their own `y` wins)
const LIFTS = new Set(['kit', 'deco', 'block', 'drawbridge']);   // kinds with a `y` that's theirs to keep (lifted with PgUp/PgDn)
const POINT_KINDS = new Set([...FLOOR_KINDS, 'circle']);    // snapped to the fine grid
function anchorY(e) {
  if (LIFTS.has(e.kind) || e.kind === 'circle') return e.y || 0;
  return FLOOR_KINDS.includes(e.kind) ? (e.y ?? C.surfaceHeight(e.x, e.z, 99)) : 0;
}
// The entry's own surfaces (kit pieces, blocks).
function surfacesOf(e) {
  if (e.kind === 'kit' || e.kind === 'block') return C.SURFACES.filter(s => s.piece === e.id);
  return [];
}
// A kit piece's footprint radius from its bounding box (pieces without colliders: banners, flags).
function kitRadius(e) {
  const b = C.KIT_MODELS[e.model]; if (!b) return 1;
  return Math.max(0.4, Math.hypot(Math.max(-b[0], b[1]), Math.max(-b[4], b[5])) * C.kitScale(e.model) * (e.scale ?? 1));
}
// A rectangle entry (floor, bounds): how far (x, z) is outside it, in metres (0 inside).
function rectOut(e, x, z) {
  const c = Math.cos(e.rotY || 0), n = Math.sin(e.rotY || 0), dx = x - e.x, dz = z - e.z, lx = dx * c - dz * n, lz = dx * n + dz * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - e.w / 2), Math.max(0, Math.abs(lz) - e.d / 2));
}
// How far (x, z) is from the entry, as a fraction of its size (< 1: on it). Gameplay points win over the pieces they stand on.
function pickScore(e, x, z) {
  if (e.kind === 'floor' || e.kind === 'bounds') { const o = rectOut(e, x, z); return o > 0 ? 1 + o : Math.min(0.999, 0.99 + Math.hypot(x - e.x, z - e.z) / 1e4); }
  if (POINT_KINDS.has(e.kind) || e.kind === 'drawbridge') {
    const r = e.kind === 'circle' ? (e.r ?? 6) * (e.scale ?? 1) / 2 : (RADIUS[e.kind] || 1.5) * (e.scale ?? 1);
    let px = e.x, pz = e.z;
    if (e.kind === 'drawbridge') { px += Math.sin(e.rotY || 0) * (e.d ?? 6) / 2; pz += Math.cos(e.rotY || 0) * (e.d ?? 6) / 2; }   // its slab's middle
    return Math.hypot(x - px, z - pz) / r * 0.6;
  }
  const sf = surfacesOf(e);
  if (sf.length) {
    let best = Infinity;
    for (const s of sf) {
      const c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0), dx = x - s.x, dz = z - s.z, lx = dx * c - dz * n, lz = dx * n + dz * c;
      const ox = Math.max(0, Math.abs(lx) - s.w / 2), oz = Math.max(0, Math.abs(lz) - s.d / 2), d = s.round ? Math.max(0, Math.hypot(lx, lz) - s.w / 2) : Math.hypot(ox, oz);
      best = Math.min(best, d);
    }
    return best > 0 ? 1 + best : 0.9 - 0.4 / (1 + sf.length);   // inside a footprint: favour small pieces over the big one they sit on
  }
  const r = e.kind === 'kit' ? kitRadius(e) * 0.8 : e.kind === 'deco' ? Math.max(0.6, (e.h || 2) * (e.scale ?? 1) * 0.4) : 1.5 * (e.scale ?? 1);
  return Math.hypot(x - e.x, z - e.z) / r;
}
// The entry under (x, y, z): a piece whose footprint is there, the one whose top is nearest the point's height winning among those
// stacked (a tower's top over its base), and gameplay points first.
function pickEntry(p) {
  let best = null, bestScore = 1;
  for (const e of L.entries) {
    let s = pickScore(e, p.x, p.z);
    if (s >= 1) continue;
    if (e.kind === 'kit') { const top = (e.y || 0) + kitTop(e); s += Math.min(0.5, Math.abs(p.y - Math.min(top, Math.max(e.y || 0, p.y))) * 0.05); }
    if (s < bestScore) { bestScore = s; best = e; }
  }
  return best;
}
const kitTop = (e) => { const b = C.KIT_MODELS[e.model]; return b ? b[3] * C.kitScale(e.model) * (e.scale ?? 1) : 1; };
function extentRadius(e) {
  if (e.kind === 'floor' || e.kind === 'bounds' || e.kind === 'block') return Math.hypot(e.w, e.d) / 2 * (e.scale ?? 1);
  if (e.kind === 'kit') return kitRadius(e);
  if (e.kind === 'circle') return (e.r ?? 6) * (e.scale ?? 1) / 2;
  if (e.kind === 'drawbridge') return Math.max(e.w ?? 3, e.d ?? 6) / 2 + 0.5;
  return e.kind === 'deco' ? Math.max(0.8, (e.h || 2) * (e.scale ?? 1) * 0.5) : (RADIUS[e.kind] || 1.5) * (e.scale ?? 1);
}

// ------------------------------------------------------------ overlays (toggles) and markers
const OVERLAYS = { colliders: 'Colliders', surfaces: 'Walkable surfaces', walls: 'Wall boxes (red: no standing)', spawns: 'Spawns', heals: 'Heal flasks', props: 'Props',
  runes: 'Runes (power-ups)', pads: 'Jump pads and their arcs', portals: 'Portals', bridge: 'The drawbridge', rim: 'Arena bounds', labels: 'Selection outline' };
const shown = { colliders: true, surfaces: false, walls: false, spawns: true, heals: true, props: true, runes: true, pads: true, portals: true, bridge: true, rim: true, labels: true };
try { Object.assign(shown, JSON.parse(localStorage.getItem('waEditOverlays2') || '{}')); } catch {}
for (const [k, name] of Object.entries(OVERLAYS)) {
  const l = document.createElement('label'); l.className = 'tog';
  l.innerHTML = `<input type="checkbox" ${shown[k] ? 'checked' : ''}> ${name}`;
  l.firstChild.onchange = (ev) => { shown[k] = ev.target.checked; try { localStorage.setItem('waEditOverlays2', JSON.stringify(shown)); } catch {} drawOverlays(); };
  $('overlays').appendChild(l);
}
const overlayRoot = new THREE.Group(); helpers.add(overlayRoot);
const lineMat = (color, opacity = 0.9) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
function circlePts(x, z, r, y, n = 24) { const p = []; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; p.push(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r); } return p; }
function lines(pts, color, opacity) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const l = new THREE.LineSegments(g, lineMat(color, opacity)); l.renderOrder = 10; return l; }
const markMat = {};
const mark = (color) => markMat[color] ??= new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
// A spawn's marker: a post, an arrow for its facing, a ring. Also the palette's ghost for a spawn.
function spawnMarker() {
  const g = new THREE.Group(), mat = mark(0x4ac8ff);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), mat); post.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 8).rotateX(Math.PI / 2), mat); head.position.set(0, 0.25, 0.9);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 24).rotateX(-Math.PI / 2), mat); ring.position.y = 0.06;
  g.add(post, head, ring); g.renderOrder = 11;
  return g;
}
const healMarker = () => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), mark(0x5aff8a)); m.position.y = 0.8; const g = new THREE.Group(); g.add(m); return g; };
const runeMarker = (type) => { const col = C.RUNES?.types?.[type]?.color ?? 0xffffff, g = new THREE.Group(); const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.45).scale(0.7, 1.2, 0.7), mark(col)); m.position.y = 1; m.rotation.y = 0.78; g.add(m, lines(circlePts(0, 0, 1.0, 0.06, 24), col, 0.9)); return g; };
const ringMarker = (r, color) => { const g = new THREE.Group(); g.add(lines(circlePts(0, 0, r, 0.06, 24), color, 0.9), lines(circlePts(0, 0, r * 0.6, 0.06, 16), color, 0.7)); return g; };
const propCache = {};
function drawOverlays() {
  for (const c of [...overlayRoot.children]) { overlayRoot.remove(c); c.geometry?.dispose?.(); }
  if (shown.colliders) {
    const low = [], tall = [];
    for (const c of C.COLLIDERS) {
      const p = c.h >= C.LOS_HEIGHT ? tall : low;
      p.push(...circlePts(c.x, c.z, c.r, 0.08, 16), ...circlePts(c.x, c.z, c.r, c.h, 16));
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) p.push(c.x + Math.cos(a) * c.r, 0.08, c.z + Math.sin(a) * c.r, c.x + Math.cos(a) * c.r, c.h, c.z + Math.sin(a) * c.r);
    }
    overlayRoot.add(lines(low, 0xffe14a, 0.7), lines(tall, 0xff8a3a, 0.8));
  }
  if (shown.surfaces || shown.walls) {
    for (const s of C.SURFACES) {
      if (s.noStand ? !shown.walls : !shown.surfaces) continue;
      const ramp = s.kind === 'ramp', geo = s.round ? new THREE.CircleGeometry(s.w / 2, 24) : new THREE.PlaneGeometry(s.w, ramp ? Math.hypot(s.d, s.y1 - s.y0) : s.d);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: s.noStand ? 0xff4040 : s.moveOnly ? 0x40c0ff : 0x40ff70, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(s.x, (ramp ? (s.y0 + s.y1) / 2 : s.top) + 0.04, s.z);
      m.rotation.order = 'YXZ'; m.rotation.y = s.yaw || 0;
      if (ramp) m.rotation.x = -Math.atan2(s.y1 - s.y0, s.d);
      m.renderOrder = 9; overlayRoot.add(m);
    }
  }
  if (shown.spawns) C.SPAWN_POINTS.forEach(([x, y, z, yaw]) => { const g = spawnMarker(); g.position.set(x, y, z); g.rotation.y = yaw; overlayRoot.add(g); });
  if (shown.heals) for (const h of C.HEAL_SPOTS) { const g = healMarker(); g.position.set(h.x, h.y, h.z); overlayRoot.add(g); }
  if (shown.props) C.PROP_SPAWNS.forEach(([type, x, z, y]) => {
    const m = (propCache[type] ??= makePropMesh(type)).clone();
    m.position.set(x, y ?? C.surfaceHeight(x, z, 99), z); overlayRoot.add(m);
  });
  if (shown.runes) for (const R of C.RUNE_SPAWNS) { const g = runeMarker(R.type); g.position.set(R.x, R.y, R.z); overlayRoot.add(g); }
  if (shown.pads) for (const P of C.JUMP_PADS) {
    const arc = C.padArc ? C.padArc(P) : null, pts = [];
    for (let i = 0; i <= 32; i++) {
      const q = arc ? C.padAt(arc, P, arc.time * i / 32) : C.padArcPoint(P, C.JUMP.gravity, i / 32);
      if (i) pts.push(...pts.slice(-3)); pts.push(q[0], q[1] + 0.9, q[2]);
    }
    const ring = ringMarker(P.r, 0x4ac8ff); ring.position.set(P.x, P.y, P.z);
    overlayRoot.add(lines(pts, 0x4ac8ff, 0.95), ring);
    const [tx, ty, tz] = P.target;   // the landing spot: a handle you drag
    overlayRoot.add(lines([tx - 0.8, ty + 0.06, tz, tx + 0.8, ty + 0.06, tz, tx, ty + 0.06, tz - 0.8, tx, ty + 0.06, tz + 0.8, tx, ty, tz, tx, ty + 1.2, tz, ...circlePts(tx, tz, 0.9, ty + 0.06, 20)], 0xffa040, 1));
  }
  if (shown.portals) for (const P of C.PORTALS) {
    overlayRoot.add(lines(circlePts(P.x, P.z, P.r, P.y + 0.06, 24), 0xff70ff, 0.9), lines(circlePts(P.x, P.z, P.r * 0.8, P.y + 2.2, 24), 0xff70ff, 0.5));
    const o = C.PORTALS.find(q => q.id === P.link);
    if (o) overlayRoot.add(lines([P.x, P.y + 1.1, P.z, o.x, o.y + 1.1, o.z], 0xff70ff, 0.6));
  }
  if (shown.bridge) for (const D of C.DRAWBRIDGES) {   // the slab down (solid) and up (dashed: where it stands in the gateway)
    const c = Math.cos(D.yaw), n = Math.sin(D.yaw), at = (lx, lz, y) => [D.x + lx * c + lz * n, y, D.z - lx * n + lz * c];
    const corners = [[-D.w / 2, 0], [D.w / 2, 0], [D.w / 2, D.d], [-D.w / 2, D.d]].map(([a, b]) => at(a, b, D.y + 0.08));
    const up = [[-D.w / 2, 0], [D.w / 2, 0]].map(([a]) => [at(a, 0, D.y), at(a, 0, D.y + D.d)]);
    overlayRoot.add(lines(corners.flatMap((p, i) => [...p, ...corners[(i + 1) % 4]]), 0xd08a40, 1), lines(up.flatMap(([a, b]) => [...a, ...b]).concat(...up[0][1], ...up[1][1]), 0xd08a40, 0.5));
  }
  if (shown.rim) {
    const B = C.ARENA_BOUNDS, y = 0.15;
    overlayRoot.add(lines([B.x0, y, B.z0, B.x1, y, B.z0, B.x1, y, B.z0, B.x1, y, B.z1, B.x1, y, B.z1, B.x0, y, B.z1, B.x0, y, B.z1, B.x0, y, B.z0], 0xffd04a, 0.9));
  }
  drawSelection();
}

// ------------------------------------------------------------ selection and the (optional) gizmo
let selection = [], mode = 'drag';
const selRoot = new THREE.Group(); helpers.add(selRoot);
const proxy = new THREE.Object3D(); helpers.add(proxy);
const gizmo = new TransformControls(camera, canvas);
gizmo.setSize(0.9);
helpers.add(gizmo.getHelper());
function drawSelection() {
  for (const c of [...selRoot.children]) { selRoot.remove(c); c.geometry?.dispose?.(); }
  if (!shown.labels) return;
  for (const id of selection) {
    const e = byId(id); if (!e) continue;
    const r = extentRadius(e), y = anchorY(e);
    selRoot.add(lines([...circlePts(e.x, e.z, r, y + 0.2, 48), ...circlePts(e.x, e.z, r, y + 0.25, 48)], 0xb48cff, 1));
  }
}
function setSelection(ids) {
  selection = ids.filter(id => byId(id));
  const e = byId(selection[0]);
  if (e && mode !== 'drag') {
    proxy.position.set(e.x, anchorY(e), e.z); proxy.rotation.set(0, e.rotY || 0, 0); proxy.scale.setScalar(1);
    gizmo.attach(proxy);
    gizmo.showY = gizmo.mode === 'rotate' || (LIFTS.has(e.kind) && gizmo.mode === 'translate');
    gizmo.showX = gizmo.showZ = gizmo.mode !== 'rotate';
  } else gizmo.detach();
  drawSelection(); inspect();
}
function setMode(m) {
  mode = m;
  if (m !== 'drag') gizmo.setMode(m);
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === m);
  setSelection(selection);
}
for (const b of document.querySelectorAll('[data-mode]')) b.onclick = () => setMode(b.dataset.mode);
const snapOn = () => $('snapGrid').checked && !keys.has('control');
const gridOf = (e) => (e.kind === 'kit' && e.model?.startsWith('keep/') ? C.KEEP_GRID / 2 : e.kind === 'kit' ? C.KIT_GRID : e.kind === 'floor' || e.kind === 'block' || e.kind === 'drawbridge' ? 1 : 0.5);
const snapXZ = (v, e) => snapOn() ? Math.round(v / gridOf(e)) * gridOf(e) : v;
function applySnap() {
  gizmo.setTranslationSnap(snapOn() ? 0.5 : null);
  gizmo.setRotationSnap(snapOn() ? Math.PI / 2 : null);
  gizmo.setScaleSnap(snapOn() ? 0.05 : null);
}
$('snapGrid').onchange = applySnap;
applySnap();
// what's under (x, z), ignoring the entries being moved (their own surfaces), or the ground
const groundUnder = (x, z, skip = null) => C.surfaceHeight(x, z, 99, skip ? C.SURFACES.filter(s => !skip.has(s.piece)) : C.SURFACES);

// the gizmo's drag: the selected entries move with the proxy (around the first one)
let gdrag = null;
gizmo.addEventListener('dragging-changed', (ev) => {
  if (ev.value) {
    const e0 = byId(selection[0]);
    gdrag = { pivot: [e0.x, e0.z], y0: anchorY(e0), start: selection.map(id => structuredClone(byId(id))) };
    pushUndo();
  } else if (gdrag) { gdrag = null; commit(); }
});
gizmo.addEventListener('objectChange', () => {
  if (!gdrag) return;
  const dx = proxy.position.x - gdrag.pivot[0], dz = proxy.position.z - gdrag.pivot[1], dy = proxy.position.y - gdrag.y0;
  const dRot = proxy.rotation.y - (gdrag.start[0].rotY || 0);
  const k = gizmo.mode === 'scale' ? Math.max(0.05, [proxy.scale.x, proxy.scale.y, proxy.scale.z].reduce((m, v) => Math.abs(v - 1) > Math.abs(m - 1) ? v : m, 1)) : 1;
  moveSet(gdrag.start, gdrag.pivot, dx, dz, dRot, { dy, k });
  liveUpdate(gdrag.start.map(s => s.id));
});
// Put the entries `start` (their state when the move began) where a move by (dx, dz) and a turn dRot round `pivot` takes them.
function moveSet(start, pivot, dx, dz, dRot, { dy = 0, k = 1 } = {}) {
  const c = Math.cos(dRot), s = Math.sin(dRot);
  for (const st of start) {
    const e = byId(st.id); if (!e) continue;
    const rx = st.x - pivot[0], rz = st.z - pivot[1];
    e.x = r4(pivot[0] + dx + rx * c + rz * s);
    e.z = r4(pivot[1] + dz - rx * s + rz * c);
    if ('rotY' in st || dRot) e.rotY = r4((((st.rotY || 0) + dRot) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
    if (k !== 1) e.scale = r4((st.scale ?? 1) * k);
    if (dy && LIFTS.has(e.kind)) e.y = r4(Math.max(0, (st.y || 0) + dy));
    if (e.kind === 'pad' && 'tx' in st) { const tx = st.tx - pivot[0], tz = st.tz - pivot[1]; e.tx = r4(pivot[0] + dx + tx * c + tz * s); e.tz = r4(pivot[1] + dz - tx * s + tz * c); }
  }
}

// ------------------------------------------------------------ direct dragging (round 29): click a piece and drag it across the map
// The drag plane is level with the grabbed piece's anchor (a wall-walk prop slides along the walk's height); with snapping on, the
// moved set lands on what's under its lowest piece (dropping a piece on a wall puts it on the walk; a tower dragged whole keeps its
// storeys). Alt at the start duplicates the selection and drags the copies; Q/E or the wheel turn the set round the grabbed piece.
let press = null, drag = null;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const rayAt = (ev) => { ndc.set(ev.clientX / innerWidth * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); return ray; };
function planeHit(ev, y) {
  const r = rayAt(ev), t = (y - r.ray.origin.y) / r.ray.direction.y;
  return t > 0 && Number.isFinite(t) ? r.ray.origin.clone().addScaledVector(r.ray.direction, t) : null;
}
// The point under the pointer: the first world surface hit, or the ground plane.
function pickPoint(ev) {
  const r = rayAt(ev), targets = scene.children.filter(o => o !== helpers && !o.isLight);
  for (const h of r.intersectObjects(targets, true)) {
    if (h.object.userData.grass || h.object.isPoints || h.object.isSprite || h.object.isLine) continue;
    if (ghost && ghost.obj.getObjectById?.(h.object.id)) continue;
    return h.point;
  }
  return planeHit(ev, 0);
}
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || looking) return;
  if (gizmo.dragging || gizmo.axis) return;   // (a click on the gizmo)
  if (placing) return;                       // placing from the palette: the click drops it (pointerup)
  const p = pickPoint(ev);
  if (!p) return;
  // a pad's landing spot is a handle of its own
  const pad = L.entries.find(e => e.kind === 'pad' && Math.hypot(p.x - e.tx, p.z - e.tz) < 1.1);
  press = { x: ev.clientX, y: ev.clientY, p, entry: pad ? null : pickEntry(p), padTarget: pad || null, alt: ev.altKey, shift: ev.shiftKey };
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (ghost) { moveGhost(ev); return; }
  if (!press) return;
  if (!drag) {
    if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) < 5 || mode !== 'drag') return;
    startDrag(ev);
    if (!drag) { press = null; return; }
  }
  dragTo(ev);
});
canvas.addEventListener('pointerup', (ev) => {
  if (ev.button !== 0) return;
  if (ghost && placing) { dropGhost(ev); return; }
  const was = press; press = null;
  if (drag) { endDrag(); return; }
  if (!was || gizmo.dragging) return;
  // a click: select
  const best = was.padTarget || was.entry;
  if (!best) { if (!was.shift) setSelection([]); return; }
  if (was.shift) setSelection(selection.includes(best.id) ? selection.filter(id => id !== best.id) : [...selection, best.id]);
  else setSelection([best.id]);
});
function startDrag(ev) {
  const P = press;
  if (P.padTarget) {   // drag a pad's landing spot
    pushUndo(); setSelection([P.padTarget.id]);
    drag = { padTarget: P.padTarget.id, ids: [P.padTarget.id] };
    hint('Release to set where the pad lands');
    return;
  }
  const e = P.entry;
  if (!e || e.kind === 'bounds') return;
  if (!selection.includes(e.id)) setSelection(P.shift ? [...selection, e.id] : [e.id]);
  pushUndo();
  if (P.alt) {   // duplicate in place, then drag the copies
    const ids = [];
    for (const id of selection) {
      const src = byId(id), c = structuredClone(src);
      c.id = newId(id.replace(/-\d+$/, '')); if (c.kind === 'heal') c.name = c.id;
      insertEntry(c); ids.push(c.id);
    }
    C.applyLayout(L);
    selection = ids;
    commit({ now: true });   // (the copies are drawn before they move away)
  }
  const e0 = byId(selection.includes(e.id) && !P.alt ? e.id : selection[0]);
  const y0 = anchorY(e0), hit = planeHit(ev, y0) || P.p;
  const lowest = selection.map(byId).filter(Boolean).reduce((a, b) => (LIFTS.has(b.kind) ? b.y || 0 : anchorY(b)) < (LIFTS.has(a.kind) ? a.y || 0 : anchorY(a)) ? b : a);
  drag = { ids: [...selection], start: selection.map(id => structuredClone(byId(id))), pivot: [e0.x, e0.z], grab: [e0.x - hit.x, e0.z - hit.z], y0, rot: 0, e0: e0.id,
    lowest: lowest.id, lowY: LIFTS.has(lowest.kind) ? lowest.y || 0 : 0, skip: new Set(selection), lastEv: ev };
  hint(`Moving ${selection.length > 1 ? selection.length + ' pieces' : e0.id} · Q/E or wheel to turn${snapOn() ? ' · hold Ctrl for no snap' : ''}`);
}
function dragTo(ev) {
  drag.lastEv = ev;
  if (drag.padTarget) {
    const e = byId(drag.padTarget), p = pickPoint(ev); if (!p) return;
    e.tx = r4(snapOn() ? Math.round(p.x * 2) / 2 : p.x); e.tz = r4(snapOn() ? Math.round(p.z * 2) / 2 : p.z);
    if ($('snapGround').checked) { const y = groundUnder(e.tx, e.tz); if (y > 0.01) e.ty = r4(y); else delete e.ty; }
    C.applyLayout(L); drawOverlays(); inspect(true); return;
  }
  const hit = planeHit(ev, drag.y0); if (!hit) return;
  const e0s = drag.start.find(s => s.id === drag.e0), probe = { ...e0s };
  const nx = snapXZ(hit.x + drag.grab[0], probe), nz = snapXZ(hit.z + drag.grab[1], probe);
  moveSet(drag.start, drag.pivot, nx - drag.pivot[0], nz - drag.pivot[1], drag.rot);
  // onto what's below: the lowest lifted piece lands on it and the rest keep their heights over it; points stand on whatever is there
  if ($('snapGround').checked) {
    const low = byId(drag.lowest), lowStart = drag.start.find(s => s.id === drag.lowest);
    if (low && LIFTS.has(low.kind) && low.kind !== 'drawbridge') {
      const dy = groundUnder(low.x, low.z, drag.skip) - drag.lowY;
      for (const st of drag.start) { const e = byId(st.id); if (e && LIFTS.has(e.kind) && e.kind !== 'drawbridge') { const y = Math.max(0, (st.y || 0) + dy); if (y < 1e-3) delete e.y; else e.y = r4(y); } }
    }
    for (const st of drag.start) {
      const e = byId(st.id);
      if (e && FLOOR_KINDS.includes(e.kind) && 'y' in st) { const y = groundUnder(e.x, e.z, drag.skip); if (y > 0.01) e.y = r4(y); else delete e.y; }
    }
    void lowStart;
  }
  liveUpdate(drag.ids);
}
function endDrag() {
  const moved = drag.ids; drag = null; hint('');
  commit(); setSelection(moved.filter(id => byId(id)));
}
// Turn what's held (a drag, or the palette's ghost) by a quarter, or 15° with Shift.
function turnHeld(dir, fine) {
  const a = dir * (fine ? Math.PI / 12 : Math.PI / 2);
  if (ghost) { ghost.rot = (ghost.rot + a + 2 * Math.PI) % (2 * Math.PI); ghost.obj.rotation.y = ghost.rot; return; }
  if (drag && !drag.padTarget) { drag.rot += a; dragTo(drag.lastEv); }
}
// While a drag runs: the map's data follows (overlays, checks next commit) and the dragged pieces' instances and objects move with it.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function liveUpdate(ids) {
  C.applyLayout(L);
  drawOverlays(); inspect(true);
  for (const id of ids) {
    const e = byId(id); if (!e) continue;
    for (const d of drawnBy.get(id) || []) {
      if (d.im) {
        d.im.setMatrixAt(d.i, _m.compose(_p.set(e.x, e.y || 0, e.z), _q.setFromAxisAngle(UP, e.rotY || 0), _s.setScalar(C.kitScale(e.model) * (e.scale ?? 1))));
        d.im.instanceMatrix.needsUpdate = true;
      } else if (d.obj) {
        const st = (drag?.start || gdrag?.start || []).find(s => s.id === id);
        if (st) { d.obj.position.set(d.at.x + e.x - st.x, d.at.y + ((e.y || 0) - (st.y || 0)), d.at.z + e.z - st.z); if (e.kind === 'drawbridge') d.obj.rotation.y = e.rotY || 0; }
      }
    }
  }
}

// a committed change: rebuild the map's exports and the world, redraw, re-check
let commitTimer = null;
function commit({ now = false } = {}) {
  clearTimeout(commitTimer);
  const run = async () => {
    C.applyLayout(L);
    drawOverlays(); setSelection(selection); runChecks();
    status('Rebuilding…');
    const t = performance.now();
    await rebuild();
    status(`${dirty ? 'Unsaved changes' : 'Up to date'} · rebuilt in ${Math.round(performance.now() - t)} ms`, dirty ? '' : 'ok');
  };
  dirty = true;
  if (now) return run(); else commitTimer = setTimeout(run, 30);
}
let dirty = false;

// ------------------------------------------------------------ undo / redo (whole-layout snapshots)
const undo = [], redo = [];
function snapshot() { return JSON.stringify({ entries: L.entries, scatter: L.scatter, map: L.map }); }
function pushUndo() { undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo.length = 0; }
function restore(json) { const s = JSON.parse(json); L.entries = s.entries; L.scatter = s.scatter; L.map = s.map; commit(); setSelection(selection); }
function doUndo() { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); }
function doRedo() { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); }
$('undoBtn').onclick = doUndo; $('redoBtn').onclick = doRedo;

// ------------------------------------------------------------ the palette: thumbnails by category, dragged onto the map
// Kit pieces are grouped by name (walls, towers, siege, nature, flags); the props, the gameplay points and the fires have
// their own groups. A tile pressed and dragged over the map shows a ghost there and drops it on release; a tile clicked arms
// it, and the next click on the map places it (Esc cancels). The search box filters every group.
const GROUPS = ['Walls and gates', 'Towers', 'Siege engines', 'Nature', 'Flags and banners', 'Props (throwable)', 'Gameplay points', 'Fires and floors', 'Other models'];
const kitGroup = (m) => /^keep\/tower/.test(m) ? 'Towers' : /^keep\/siege/.test(m) ? 'Siege engines' : /^keep\/(tree|rocks|ground)/.test(m) ? 'Nature'
  : /^keep\/flag/.test(m) ? 'Flags and banners' : 'Walls and gates';
const label = (m) => m.split('/').pop().replace(/[-_]/g, ' ');
const PALETTE = [
  { group: 'Gameplay points', label: 'Spawn', icon: 'spawn', make: () => ({ kind: 'spawn', rotY: 0 }) },
  { group: 'Gameplay points', label: 'Heal flask', icon: 'heal', make: () => ({ kind: 'heal', name: 'heal' }) },
  { group: 'Gameplay points', label: 'Rune', icon: 'rune', make: () => ({ kind: 'rune' }) },
  { group: 'Gameplay points', label: 'Jump pad', icon: 'pad', make: () => ({ kind: 'pad', tx: 0, tz: 0, h: 4 }) },   // (lands 6 m ahead; drag its orange cross)
  { group: 'Gameplay points', label: 'Portal', icon: 'portal', make: () => ({ kind: 'portal', link: '' }) },
  { group: 'Gameplay points', label: 'Drawbridge', icon: 'bridge', make: () => ({ kind: 'drawbridge', rotY: 0, y: 0.25, w: 2.8, d: 5.2, thick: 0.35 }) },
  { group: 'Gameplay points', label: 'Invisible wall', icon: 'block', make: () => ({ kind: 'block', rotY: 0, w: 2, d: 2, h: 3 }) },
  { group: 'Gameplay points', label: 'Rune circle', icon: 'circle', make: () => ({ kind: 'circle', r: 6, h: 5 }) },
  ...Object.keys(C.PROP_TYPES).map(t => ({ group: 'Props (throwable)', label: t, prop: t, make: () => ({ kind: 'prop', type: t }) })),
  { group: 'Fires and floors', label: 'Brazier', icon: 'brazier', make: () => ({ kind: 'brazier' }) },
  { group: 'Fires and floors', label: 'Torch', icon: 'torch', make: () => ({ kind: 'brazier', style: 'torch' }) },
  ...(C.FLOOR_TONES || []).map(t => ({ group: 'Fires and floors', label: `${t} floor`, icon: 'floor-' + t, make: () => ({ kind: 'floor', tone: t, rotY: 0, w: 8, d: 8 }) })),
];
const SPECIAL_MODELS = new Set(['ram', 'potion', 'ice_wall', 'acid_puddle']);
async function buildPalette() {
  let models = [];
  try { models = await (await fetch('/api/map/models')).json(); } catch {}
  for (const m of Object.keys(C.KIT_MODELS).filter(m => m.startsWith('keep/'))) PALETTE.push({ group: kitGroup(m), label: label(m), title: m, model: m, make: () => ({ kind: 'kit', model: m, rotY: 0 }) });
  for (const m of models.filter(m => !m.includes('/') && !SPECIAL_MODELS.has(m))) PALETTE.push({ group: 'Other models', label: m, title: m, make: () => ({ kind: 'deco', model: m, rotY: 0, h: 2 }) });
  drawPalette();
}
const thumbs = new Map();   // palette item -> data URL
function drawPalette() {
  const root = $('palette'), q = $('palSearch').value.trim().toLowerCase();
  root.innerHTML = '';
  for (const g of GROUPS) {
    const items = PALETTE.filter(it => it.group === g && (!q || it.label.toLowerCase().includes(q) || (it.title || '').toLowerCase().includes(q)));
    if (!items.length) continue;
    const d = document.createElement('details'); d.open = !!q || openGroups.has(g);
    d.ontoggle = () => { if (d.open) openGroups.add(g); else openGroups.delete(g); };
    d.innerHTML = `<summary><b>${g}</b> (${items.length})</summary>`;
    const grid = document.createElement('div'); grid.className = 'grid'; d.appendChild(grid);
    for (const item of items) {
      const t = document.createElement('div'); t.className = 'tile' + (placing === item ? ' on' : ''); t.title = item.title || item.label;
      const img = document.createElement('img'); img.src = thumbs.get(item) || iconFor(item); img.draggable = false;
      const span = document.createElement('span'); span.textContent = item.label;
      t.append(img, span); item.el = t; item.img = img;
      t.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.preventDefault(); pickTile(item, ev); } });
      grid.appendChild(t);
    }
    root.appendChild(d);
  }
}
const openGroups = new Set(['Walls and gates', 'Gameplay points']);
$('palSearch').oninput = drawPalette;
// A drawn icon for the gameplay points (no model to render).
function iconFor(item) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), k = item.icon || '';
  g.lineWidth = 4; g.lineCap = 'round';
  const ring = (col) => { g.strokeStyle = col; g.beginPath(); g.ellipse(32, 46, 22, 9, 0, 0, Math.PI * 2); g.stroke(); };
  if (k === 'spawn') { ring('#4ac8ff'); g.fillStyle = '#4ac8ff'; g.fillRect(30, 12, 4, 34); g.beginPath(); g.moveTo(32, 30); g.lineTo(48, 40); g.lineTo(38, 44); g.fill(); }
  else if (k === 'heal') { g.fillStyle = '#5aff8a'; g.beginPath(); g.moveTo(32, 8); g.lineTo(48, 32); g.lineTo(32, 56); g.lineTo(16, 32); g.fill(); g.fillStyle = '#fff'; g.fillRect(29, 22, 6, 20); g.fillRect(22, 29, 20, 6); }
  else if (k === 'rune') { ring('#c9a6ff'); g.fillStyle = '#c9a6ff'; g.beginPath(); g.moveTo(32, 6); g.lineTo(42, 26); g.lineTo(32, 44); g.lineTo(22, 26); g.fill(); }
  else if (k === 'pad') { ring('#4ac8ff'); g.strokeStyle = '#ffa040'; g.beginPath(); g.moveTo(14, 46); g.quadraticCurveTo(32, -10, 54, 30); g.stroke(); }
  else if (k === 'portal') { g.strokeStyle = '#ff70ff'; g.beginPath(); g.ellipse(32, 32, 14, 24, 0, 0, Math.PI * 2); g.stroke(); }
  else if (k === 'bridge') { g.fillStyle = '#b06a3c'; g.save(); g.translate(32, 36); g.rotate(-0.5); g.fillRect(-12, -24, 24, 44); g.restore(); g.strokeStyle = '#444'; g.beginPath(); g.moveTo(14, 8); g.lineTo(42, 22); g.stroke(); }
  else if (k === 'block') { g.strokeStyle = '#9aa0b4'; g.setLineDash([6, 5]); g.strokeRect(14, 14, 36, 36); }
  else if (k === 'circle') { g.strokeStyle = '#a070ff'; g.beginPath(); g.ellipse(32, 44, 24, 10, 0, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#c9a6ff'; g.beginPath(); g.moveTo(32, 6); g.lineTo(38, 20); g.lineTo(32, 32); g.lineTo(26, 20); g.fill(); }
  else if (k === 'brazier' || k === 'torch') {
    g.strokeStyle = '#333a44';
    if (k === 'brazier') { g.beginPath(); g.moveTo(20, 58); g.lineTo(30, 36); g.moveTo(44, 58); g.lineTo(34, 36); g.stroke(); g.fillStyle = '#333a44'; g.beginPath(); g.moveTo(14, 30); g.lineTo(50, 30); g.lineTo(42, 40); g.lineTo(22, 40); g.fill(); }
    else { g.strokeStyle = '#8a5030'; g.beginPath(); g.moveTo(32, 60); g.lineTo(32, 26); g.stroke(); }
    g.fillStyle = '#ffb040'; g.beginPath(); g.moveTo(32, 4); g.quadraticCurveTo(46, 22, 32, 30); g.quadraticCurveTo(18, 22, 32, 4); g.fill();
  } else if (k.startsWith('floor-')) {
    g.fillStyle = { stone: '#868ba1', sand: '#e5ac86', dirt: '#865542', water: '#79a6e3' }[k.slice(6)] || '#888'; g.fillRect(8, 16, 48, 32);
  } else { g.fillStyle = '#556'; g.fillRect(16, 16, 32, 32); }
  return c.toDataURL();
}
// Each kit piece and prop rendered once (a small offscreen renderer, the game's material and a three-quarter view), a few a frame.
let thumbR = null;
async function renderThumbs() {
  thumbR ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  thumbR.setSize(96, 96); thumbR.outputColorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  s.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 2.2)); const sunL = new THREE.DirectionalLight(0xfff0dd, 2.2); sunL.position.set(3, 5, 4); s.add(sunL);
  for (const item of PALETTE.filter(it => it.model || it.prop)) {
    try {
      const obj = item.model ? await ghostOfKit(item.model, false) : makePropMesh(item.prop);
      s.add(obj);
      const box = new THREE.Box3().setFromObject(obj), sph = box.getBoundingSphere(new THREE.Sphere());
      const dir = new THREE.Vector3(1, 0.8, 1.25).normalize();
      cam.position.copy(sph.center).addScaledVector(dir, sph.radius / Math.sin(cam.fov * Math.PI / 360) * 1.02); cam.lookAt(sph.center);
      thumbR.render(s, cam);
      const url = thumbR.domElement.toDataURL();
      thumbs.set(item, url); if (item.img) item.img.src = url;
      s.remove(obj);
      await new Promise(r => setTimeout(r, 0));
    } catch (err) { console.warn('[editor] thumbnail', item.label, err); }
  }
}

// ------------------------------------------------------------ the ghost: what a palette tile will place, under the pointer
let placing = null, ghost = null;
const ghostMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
// A kit piece as a group of meshes in metres (ghost: translucent; thumbnail: the game's material).
async function ghostOfKit(model, translucent = true, tint = null) {
  const meshes = await kitModelMeshes(loader, model), g = new THREE.Group(), inner = new THREE.Group();
  if (translucent) { const tex = kitMaterial().map; ghostMat.map = tex; ghostMat.needsUpdate = true; }
  for (const [geo] of meshes) inner.add(new THREE.Mesh(tint ? tintGeometry(geo, tint) : geo, translucent ? ghostMat : kitMaterial()));
  inner.scale.setScalar(C.kitScale(model));
  g.add(inner);
  return g;
}
async function ghostFor(item) {
  if (item.model) return ghostOfKit(item.model);
  if (item.prop) return makePropMesh(item.prop);
  const k = item.icon;
  if (k === 'spawn') return spawnMarker();
  if (k === 'heal') return healMarker();
  if (k === 'rune') return runeMarker(null);
  if (k === 'pad' || k === 'portal') return ringMarker(1.1, k === 'pad' ? 0x4ac8ff : 0xff70ff);
  if (k === 'brazier' || k === 'torch') { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(k === 'torch' ? 0.1 : 0.45, k === 'torch' ? 0.1 : 0.3, k === 'torch' ? 2.2 : 1.2, 8), mark(0xffa040)); m.position.y = k === 'torch' ? 1.1 : 0.6; g.add(m); return g; }
  const e = item.make(), w = e.w ?? (e.r ?? 2), d = e.d ?? (e.r ?? 2), g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d).translate(0, 0.05, e.kind === 'drawbridge' ? d / 2 : 0), mark(0xb48cff)); g.add(m);
  return g;
}
async function pickTile(item, ev) {
  cancelPlacing();
  placing = item; for (const it of PALETTE) it.el?.classList.toggle('on', it === item);
  const obj = await ghostFor(item);
  if (placing !== item) return;
  ghost = { item, obj, rot: 0, at: null, fromTile: true };
  obj.visible = false; obj.traverse(o => { o.renderOrder = 12; });
  helpers.add(obj);
  const icon = $('dragIcon'); icon.src = thumbs.get(item) || iconFor(item); icon.style.display = 'block';
  const follow = (e) => { icon.style.left = e.clientX - 28 + 'px'; icon.style.top = e.clientY - 28 + 'px'; const over = document.elementFromPoint(e.clientX, e.clientY) === canvas; icon.style.display = over ? 'none' : 'block'; if (over) moveGhost(e); else if (ghost) ghost.obj.visible = false; };
  const up = (e) => {
    removeEventListener('pointermove', follow); removeEventListener('pointerup', up);
    icon.style.display = 'none';
    if (!ghost) return;
    if (document.elementFromPoint(e.clientX, e.clientY) === canvas && ghost.at) dropGhost(e);   // dragged onto the map
    else if (Math.hypot(e.clientX - ev.clientX, e.clientY - ev.clientY) < 5) { ghost.fromTile = false; hint(`Click the map to place ${item.label} · Q/E or wheel to turn · Esc to cancel`); }   // a click: armed
    else cancelPlacing();
  };
  addEventListener('pointermove', follow); addEventListener('pointerup', up);
  follow(ev);
}
function ghostEntry() { return { ...ghost.item.make(), rotY: ghost.rot }; }
function moveGhost(ev) {
  if (!ghost) return;
  const p = pickPoint(ev); if (!p) { ghost.obj.visible = false; return; }
  const e = ghostEntry(), x = snapXZ(p.x, e), z = snapXZ(p.z, e);
  const y = $('snapGround').checked ? groundUnder(x, z) : 0;
  ghost.at = { x, y, z };
  ghost.obj.position.set(x, y, z); ghost.obj.rotation.y = ghost.rot; ghost.obj.visible = true;
}
function dropGhost(ev) {
  moveGhost(ev);
  if (!ghost?.at) return;
  const { x, y, z } = ghost.at, item = ghost.item;
  pushUndo();
  const e = { id: '', ...item.make(), x: r4(x), z: r4(z) };
  if ('rotY' in e || ghost.rot) e.rotY = r4(ghost.rot);
  e.id = newId(e.kind === 'deco' ? e.model : e.kind === 'kit' ? e.model.split('/').pop() : e.kind === 'prop' ? `prop-${e.type}` : e.kind === 'floor' ? `floor-${e.tone}` : e.kind === 'brazier' ? (e.style || 'brazier') : e.kind);
  if (e.kind === 'heal') e.name = e.id;
  if (e.kind === 'pad') { e.tx = r4(x + 6 * Math.sin(ghost.rot)); e.tz = r4(z + 6 * Math.cos(ghost.rot)); }
  if (e.kind === 'drawbridge') e.y = r4(y + 0.25);
  else if (LIFTS.has(e.kind) && y > 0.01) e.y = r4(y);
  insertEntry(e);
  const keepArmed = !ghost.fromTile && ev.shiftKey;   // Shift-click places another of the same
  if (!keepArmed) cancelPlacing();
  commit(); setSelection([e.id]);
  status(`Placed ${e.id}`, 'ok');
}
function cancelPlacing() {
  placing = null; hint('');
  if (ghost) { helpers.remove(ghost.obj); ghost = null; }
  for (const it of PALETTE) it.el?.classList.remove('on');
}
function newId(base) { let i = 1; while (byId(`${base}-${i}`)) i++; return `${base}-${i}`; }
// props keep their ids in order (index + 1): a new entry goes after the last of its kind
function insertEntry(e) { const last = L.entries.map(q => q.kind).lastIndexOf(e.kind); L.entries.splice(last >= 0 ? last + 1 : L.entries.length, 0, e); }

// ------------------------------------------------------------ the inspector: the selected entry's fields
function inspect(live = false) {
  const root = $('inspector');
  if (!selection.length) { root.innerHTML = '<div id="help">Click a piece to select it, or drag one from the palette.</div>'; return; }
  if (selection.length > 1) { root.innerHTML = `<div class="sel-title">${selection.length} selected</div><div id="help">${selection.join(', ')}</div>`; return; }
  const e = byId(selection[0]); if (!e) return;
  const fields = ['id', 'x', 'z', 'rotY', 'scale', ...(C.LAYOUT_KINDS[e.kind] || [])];
  if (live && root.dataset.id === e.id) {   // during a drag: just refresh the numbers
    for (const inp of root.querySelectorAll('input[data-k]')) if (typeof e[inp.dataset.k] === 'number' && document.activeElement !== inp) inp.value = +e[inp.dataset.k].toFixed(3);
    return;
  }
  root.dataset.id = e.id;
  root.innerHTML = `<div class="sel-title">${e.kind}${e.model ? ' · ' + e.model : ''}</div>`;
  for (const k of fields) {
    const v = k === 'rotY' ? (e.rotY ?? 0) : k === 'scale' ? (e.scale ?? 1) : e[k];
    if (v === undefined && !['h', 'y', 'r', 'ty', 'type', 'link', 'tint', 'light'].includes(k) && !(e.kind === 'kit' && k === 'solid')) continue;
    const row = document.createElement('div'); row.className = 'field';
    row.innerHTML = `<span>${k === 'rotY' ? 'rotY (rad)' : k}</span>`;
    const inp = document.createElement('input');
    inp.dataset.k = k; inp.value = typeof v === 'number' ? +v.toFixed(3) : (v ?? '');
    if ((typeof v === 'number' || v === undefined) && k !== 'tint' && k !== 'type' && k !== 'link') inp.type = 'number', inp.step = k === 'rotY' ? '0.05' : '0.1';
    inp.onchange = () => {
      pushUndo();
      const raw = inp.value, num = inp.type === 'number' ? parseFloat(raw) : null;
      if (k === 'id') { if (!raw || byId(raw)) { inp.value = e.id; return; } e.id = raw; selection = [raw]; }
      else if (inp.type === 'number') { if (raw === '' && k !== 'x' && k !== 'z') delete e[k]; else if (!Number.isFinite(num)) return; else if (k === 'scale' && num === 1) delete e.scale; else e[k] = num; }
      else if (raw === '') delete e[k]; else e[k] = raw;
      commit(); setSelection(selection);
    };
    row.appendChild(inp); root.appendChild(row);
  }
  const row = document.createElement('div'); row.style.marginTop = '8px';
  row.innerHTML = '<button id="dupBtn">Duplicate</button> <button id="delBtn">Delete</button>';
  root.appendChild(row);
  $('dupBtn').onclick = duplicate; $('delBtn').onclick = remove;
}
function duplicate() {
  if (!selection.length) return;
  pushUndo();
  const ids = [];
  for (const id of selection) {
    const e = byId(id), c = structuredClone(e);
    c.id = newId(id.replace(/-\d+$/, ''));
    const step = e.kind === 'kit' ? C.kitGrid?.(e.model) ?? 4 : 1.5;   // one tile along the piece's local z (a wall's run), or 1.5 m
    c.x = r4(c.x + Math.sin(c.rotY || 0) * step); c.z = r4(c.z + Math.cos(c.rotY || 0) * step);
    if (e.kind === 'pad') { c.tx = r4(c.tx + c.x - e.x); c.tz = r4(c.tz + c.z - e.z); }
    if (c.kind === 'heal') c.name = c.id;
    L.entries.splice(L.entries.indexOf(e) + 1, 0, c); ids.push(c.id);
  }
  commit(); setSelection(ids);
}
const SINGLETONS = new Set(['bounds']);
function remove() {
  const ids = selection.filter(id => !SINGLETONS.has(byId(id)?.kind));
  if (ids.length < selection.length) status('The arena bounds can be moved and resized but not deleted', 'err');
  if (!ids.length) return;
  pushUndo();
  L.entries = L.entries.filter(e => !ids.includes(e.id));
  commit(); setSelection([]);
}

// Turn the selection round its first entry (a quarter, or 15° with Shift), or lift it, as one undo step.
function nudge({ rot = 0, lift = 0 }) {
  if (!selection.length) return;
  pushUndo();
  const e0 = byId(selection[0]), c = Math.cos(rot), s = Math.sin(rot);
  for (const id of selection) {
    const e = byId(id); if (!e) continue;
    if (rot) {
      const rx = e.x - e0.x, rz = e.z - e0.z; e.x = r4(e0.x + rx * c + rz * s); e.z = r4(e0.z - rx * s + rz * c);
      e.rotY = r4((((e.rotY || 0) + rot) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
      if (e.kind === 'pad') { const tx = e.tx - e0.x, tz = e.tz - e0.z; e.tx = r4(e0.x + tx * c + tz * s); e.tz = r4(e0.z - tx * s + tz * c); }
    }
    if (lift && (LIFTS.has(e.kind) || FLOOR_KINDS.includes(e.kind))) { const y = Math.max(0, anchorY(e) + lift); if (y < 1e-3) delete e.y; else e.y = r4(y); }
  }
  commit(); setSelection(selection);
}

// ------------------------------------------------------------ checks (warnings, not blockers)
function runChecks() {
  const out = [];
  const warn = (text, at) => out.push({ text, at });
  // colliders overlapping spawns, heal spots and props
  for (const [i, [x, , z]] of C.SPAWN_POINTS.entries()) for (const c of C.COLLIDERS) if (Math.hypot(c.x - x, c.z - z) < c.r + C.PLAYER_RADIUS) { warn(`Spawn ${i + 1} is inside a ${c.kind} collider`, [x, z]); break; }
  for (const h of C.HEAL_SPOTS) for (const c of C.COLLIDERS) if (c.h > h.y + 0.3 && Math.hypot(c.x - h.x, c.z - h.z) < c.r + 0.4) { warn(`Heal spot ${h.id} is inside a ${c.kind} collider`, [h.x, h.z]); break; }
  C.PROP_SPAWNS.forEach(([type, x, z], i) => { for (const c of C.COLLIDERS) if (c.h > 0.5 && Math.hypot(c.x - x, c.z - z) < c.r + C.PROP_TYPES[type].r * 0.8) { warn(`Prop ${i + 1} (${type}) overlaps a ${c.kind} collider`, [x, z]); break; } });
  // spawns: 15 m apart, out of each other's sight at chest height
  const S = C.SPAWN_POINTS;
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const a = [S[i][0], S[i][1] + 1.3, S[i][2]], b = [S[j][0], S[j][1] + 1.3, S[j][2]], d = Math.hypot(a[0] - b[0], a[2] - b[2]);
    if (d < 15) warn(`Spawns ${i + 1} and ${j + 1} are only ${d.toFixed(1)} m apart (15 m minimum)`, [a[0], a[2]]);
    else if (!C.pillarBlocks(a, b, 0) && !C.surfaceBlocks(a, b) && !C.losVolumeBlocks(a, b)) warn(`Spawns ${i + 1} and ${j + 1} can see each other`, [a[0], a[2]]);
  }
  // gameplay spots outside the bounds, or inside something solid
  for (const e of L.entries) if (['spawn', 'heal', 'prop', 'rune', 'pad'].includes(e.kind) && !C.insideArena(e.x, e.z, 0.3)) warn(`${e.id} is outside the arena bounds`, [e.x, e.z]);
  for (const e of L.entries) if (['spawn', 'heal', 'prop', 'rune'].includes(e.kind)) { const y = e.y ?? C.surfaceHeight(e.x, e.z, 99), s = C.surfaceSolidAt(e.x, y + 0.6, e.z); if (s) warn(`${e.id} is inside ${s.piece || s.name}`, [e.x, e.z]); }
  // props near an edge: a prop up on a wall or a tower within its own radius of the floor's edge (it rolls off when the round starts
  // or hangs half over the drop)
  C.PROP_SPAWNS.forEach(([type, x, z, y], i) => {
    if (!(y > 0.05)) return;
    const r = C.PROP_TYPES[type].r + 0.15;
    if ([[r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dz]) => C.surfaceHeight(x + dx, z + dz, y + 0.05) < y - 0.3)) warn(`Prop ${i + 1} (${type}) is near the edge of the floor it stands on`, [x, z]);
  });
  for (const e of L.entries) if (Math.hypot(e.x, e.z) > C.ARENA_RADIUS + 25) warn(`${e.id} is far outside the arena`, [e.x, e.z]);
  // platforms with no way up (a walk, a jump, a double jump plus a ledge grab, a jump pad, from the ground or a reachable surface)
  for (const s of unreachableSurfaces()) warn(`${s.name} has no way up`, [s.x, s.z]);
  const root = $('warnings'); root.innerHTML = '';
  if (!out.length) { root.innerHTML = '<div class="ok">No problems found.</div>'; return out; }
  for (const w of out) {
    const d = document.createElement('div'); d.textContent = '⚠ ' + w.text;
    d.onclick = () => { if (cam.top) cam.pos.set(w.at[0], cam.pos.y, w.at[1]); else { cam.pos.set(w.at[0] - Math.sin(cam.yaw) * 14, 10, w.at[1] - Math.cos(cam.yaw) * 14); cam.pitch = -0.5; } };
    root.appendChild(d);
  }
  return out;
}
function unreachableSurfaces() {
  const reach = C.JUMP.height + C.AIR_JUMP.height, grab = reach + C.LEDGE.reach, step = C.STEP_UP;
  const sTopAt = (s, x, z) => { if (s.kind !== 'ramp') return s.top; const c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0), lz = (x - s.x) * n + (z - s.z) * c; return s.y0 + (s.y1 - s.y0) * Math.max(0, Math.min(1, lz / s.d + 0.5)); };
  // (round 29: a surface whose whole top is under something solid, like a tower storey under the next, isn't a floor anyone stands on)
  const covered = (s) => s.kind !== 'ramp' && surfaceCornersIn(s).every(([x, z]) => C.surfaceSolidAt(x, s.top + 0.6, z));
  const stand = C.SURFACES.filter(s => !s.noStand && !s.drawbridge && !covered(s));
  const inside = (s, x, z, pad = 0) => { const c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0), dx = x - s.x, dz = z - s.z, lx = dx * c - dz * n, lz = dx * n + dz * c; return s.round ? Math.hypot(lx, lz) <= s.w / 2 + pad : Math.abs(lx) <= s.w / 2 + pad && Math.abs(lz) <= s.d / 2 + pad; };
  const edge = (s) => {
    const pts = [], c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0);
    for (let i = 0; i < 24; i++) {
      let lx, lz, nx, nz;
      if (s.round) { const a = i / 24 * Math.PI * 2; lx = Math.sin(a) * s.w / 2 * 0.97; lz = Math.cos(a) * s.d / 2 * 0.97; nx = Math.sin(a); nz = Math.cos(a); }
      else { const t = i / 24 * 4, side = Math.floor(t), f = t - side, P = [[-1, -1], [1, -1], [1, 1], [-1, 1]][side], Q = [[1, -1], [1, 1], [-1, 1], [-1, -1]][side];
        lx = (P[0] + (Q[0] - P[0]) * f) * s.w / 2 * 0.97; lz = (P[1] + (Q[1] - P[1]) * f) * s.d / 2 * 0.97;
        const ax = Math.abs(lx) / (s.w / 2), az = Math.abs(lz) / (s.d / 2); [nx, nz] = ax > az ? [Math.sign(lx), 0] : [0, Math.sign(lz)]; }
      const wx = s.x + lx * c + lz * n, wz = s.z - lx * n + lz * c, wnx = nx * c + nz * n, wnz = -nx * n + nz * c;
      pts.push([wx, wz, wx + wnx * 0.7, wz + wnz * 0.7]);
    }
    return pts;
  };
  const reached = new Set(), sky = C.MAP_INFO?.ground === 'none';
  if (sky) for (const [x, , z] of C.SPAWN_POINTS) for (const s of stand) if (inside(s, x, z)) reached.add(s);
  const JUMP_GAP = 3.5, GAP_STEPS = [1, 1.5, 2, 2.5, 3, 3.5];
  // a pad on the ground (round 29: the keep's pads stand on the grass) or on a reached floor
  const padFrom = (P) => (!sky && P.y < 0.05 && C.insideArena(P.x, P.z)) || [...reached].some(q => inside(q, P.x, P.z, 0.3));
  for (let pass = 0, grew = true; grew && pass < 16; pass++) {
    grew = false;
    for (const P of C.JUMP_PADS || []) if (padFrom(P)) for (const s of stand) if (!reached.has(s) && inside(s, P.target[0], P.target[2], 0.1) && Math.abs(sTopAt(s, P.target[0], P.target[2]) - P.target[1]) < 0.6) { reached.add(s); grew = true; }
    for (const s of stand) {
      if (reached.has(s)) continue;
      for (const [ex, ez, ox, oz] of edge(s)) {
        const top = sTopAt(s, ex, ez);
        let floor = !sky && C.insideArena(ox, oz) ? 0 : -Infinity;
        for (const q of reached) if (inside(q, ox, oz, 0.1)) floor = Math.max(floor, sTopAt(q, ox, oz));
        for (const q of reached) if (q !== s && inside(q, ex, ez, 0.1) && Math.abs(sTopAt(q, ex, ez) - top) < step + 0.05) floor = Math.max(floor, top);
        if (top - floor <= Math.max(step + 0.05, grab)) { reached.add(s); grew = true; break; }
        let jumpFloor = -Infinity;
        const nx = (ox - ex) / 0.7, nz = (oz - ez) / 0.7;
        for (const g of GAP_STEPS) { const px = ex + nx * g, pz = ez + nz * g; for (const q of reached) if (q !== s && inside(q, px, pz, 0.1)) jumpFloor = Math.max(jumpFloor, sTopAt(q, px, pz)); }
        if (top - jumpFloor <= reach) { reached.add(s); grew = true; break; }
      }
    }
  }
  return stand.filter(s => !reached.has(s) && !s.ladder && !s.moveOnly && !(s.style === 'block' && s.top <= 0.05));
}
const surfaceCornersIn = (s) => C.surfaceCorners(s).map(([x, z]) => [s.x + (x - s.x) * 0.9, s.z + (z - s.z) * 0.9]);

// ------------------------------------------------------------ save, test play, export, import
async function save() {
  const bad = C.validateLayout(L);
  if (bad.length) { status('Not saved: ' + bad[0], 'err'); return false; }
  status('Saving…');
  try {
    const res = await fetch(`/api/map/layout?map=${encodeURIComponent(MAP)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(L) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { status(`Not saved: ${j.error || res.status}`, 'err'); return false; }
    dirty = false;
    status(`Saved ${C.MAPS[MAP]?.file} ${new Date().toLocaleTimeString()} (the old file is in tools/layout-backups/)`, 'ok');
    return true;
  } catch (err) { status('Not saved: ' + err.message, 'err'); return false; }
}
$('saveBtn').onclick = save;
// Save, wait for the server to take the new layout (npm run edit restarts it when the file changes: /api/map/status reports a later
// start), then open a match in a new tab. Under a plain `node server.js` there's no restart: the tab opens after a few seconds anyway
// and the status says so.
$('playBtn').onclick = async () => {
  const tab = window.open('about:blank', '_blank');   // (opened in the click, so it isn't blocked as a popup)
  const at = Date.now();
  if (!(await save())) { tab?.close(); return; }
  status('Saved · waiting for the server to load it…');
  let fresh = false;
  for (let i = 0; i < 40 && !fresh; i++) {
    await new Promise(r => setTimeout(r, 250));
    try { const s = await (await fetch('/api/map/status', { cache: 'no-store' })).json(); fresh = s.started > at; } catch { /* restarting */ }
  }
  const url = new URL('/', location.href); if (MAP !== C.DEFAULT_MAP) url.searchParams.set('map', MAP);
  if (tab) tab.location = url.toString(); else window.open(url.toString(), '_blank');
  status(fresh ? 'Test play opened in a new tab (the server reloaded the layout)' : 'Test play opened · the server didn\'t restart: run it with npm run edit to play the saved layout', fresh ? 'ok' : 'err');
};
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([C.formatLayout(L)], { type: 'application/json' }));
  a.download = C.MAPS[MAP]?.file || 'layout.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text()), bad = C.validateLayout(j);
    if (bad.length) { status('Not imported: ' + bad[0], 'err'); return; }
    pushUndo(); L.entries = j.entries; L.scatter = j.scatter; L.map = j.map; commit(); setSelection([]);
    status('Imported (not saved yet)');
  } catch (err) { status('Not imported: ' + err.message, 'err'); }
  ev.target.value = '';
};
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ------------------------------------------------------------ keys
const STOREY = 1.01 * C.KEEP_SCALE;   // one Kenney tower storey (4.04 m)
addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  const k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
  if (k === 'control') keys.add('control');
  if (mod && k === 's') { ev.preventDefault(); save(); return; }
  if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && k === 'y') { ev.preventDefault(); doRedo(); return; }
  if (mod && k === 'd') { ev.preventDefault(); duplicate(); return; }
  if (k === 'shift') keys.add('shift');
  if (looking) { keys.add(k); return; }                       // flying: WASD/QE move the camera
  if (k === 'q' || k === 'e') { const dir = k === 'q' ? 1 : -1; if (drag || ghost) turnHeld(dir, ev.shiftKey); else nudge({ rot: dir * (ev.shiftKey ? Math.PI / 12 : Math.PI / 2) }); return; }
  if (k === '1') setMode('drag');
  else if (k === '2') setMode('translate');
  else if (k === '3') setMode('rotate');
  else if (k === '4') setMode('scale');
  else if (k === 't') toggleTop();
  else if (k === 'delete' || k === 'backspace') { ev.preventDefault(); remove(); }
  else if ((k === '[' || k === ']') && selection.length) nudge({ rot: k === ']' ? -Math.PI / 2 : Math.PI / 2 });
  else if ((k === 'pageup' || k === 'pagedown') && selection.length) { ev.preventDefault(); const s = ev.shiftKey ? 0.25 : STOREY; nudge({ lift: k === 'pageup' ? s : -s }); }
  else if (k === 'escape') { cancelPlacing(); setSelection([]); }
});
addEventListener('keyup', (ev) => { keys.delete(ev.key.toLowerCase()); });
addEventListener('blur', () => { keys.clear(); looking = false; });

// ------------------------------------------------------------ start
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  moveCamera(dt); placeCamera();
  for (const s of spinners) s.rotation.y += dt * 0.8;
  if (scene) renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
window.__edit = { L, C, select: (ids) => setSelection(ids), commit, save, runChecks, cam, toggleTop, gizmo, proxy, get scene() { return scene; }, get selection() { return selection; },
  rebuild, status: () => $('status').textContent, palette: PALETTE, thumbs, get drag() { return drag; }, get ghost() { return ghost; }, camera };
status('Loading the map…');
drawOverlays(); runChecks();
const paletteReady = buildPalette();
requestAnimationFrame(frame);
const t0 = performance.now();
rebuild().then(async () => {
  status(`Ready · ${C.MAPS[MAP]?.title ?? MAP} · ${L.entries.length} entries · loaded in ${Math.round(performance.now() - t0)} ms`, 'ok');
  await paletteReady; renderThumbs();   // (after the first build: the props' models are in)
});
