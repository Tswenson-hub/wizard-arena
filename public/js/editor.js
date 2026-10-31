// The map editor (?edit=1, served as edit.html by server/mapedit.js): the real map, a fly camera, select and move
// assets with a gizmo, an asset palette, undo, overlays and layout checks, and Save straight to
// public/shared/layout.json (only when the server runs with MAP_EDIT=1, from localhost). Every change edits the layout
// entries (shared/layout.json, read by map.js), then applyLayout() rebuilds the map's exports in place and the world is
// built again from them, so what you see is what the game will play.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as C from '../shared/constants.js';
import { buildWorld, loadModels, makePropMesh, spinners } from './world.js';

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
const byId = (id) => L.entries.find(e => e.id === id);
const status = (text, cls = '') => { const s = $('status'); s.textContent = text; s.className = cls; };

// ------------------------------------------------------------ the world, rebuilt from the layout after each change
// GLTF files load once; each build gets fresh clones (world.js fits and places what it's given).
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), gltfCache = new Map();
const loader = {
  load(url, onLoad, onProgress, onError) {
    if (!gltfCache.has(url)) gltfCache.set(url, gltfLoader.loadAsync(url));
    gltfCache.get(url).then(g => onLoad({ ...g, scene: g.scene.clone(true) }), onError);
  },
};
const helpers = new THREE.Group();                   // overlays, markers, the selection and the gizmo: moved into each new scene
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
  })();
  await building;
  building = null;
  if (again) { again = false; return rebuild(); }
}

// ------------------------------------------------------------ camera: fly with the right button held, or top-down
const cam = { pos: new THREE.Vector3(0, 38, 52), yaw: Math.PI, pitch: -0.62, top: false };
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
  if (cam.top) { cam.pos.y = Math.max(15, Math.min(160, cam.pos.y * (1 + e.deltaY * 0.001))); return; }
  cam.pos.addScaledVector(camDir(), -e.deltaY * 0.03);
}, { passive: false });
function camDir() { return new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)); }
function toggleTop() {
  cam.top = !cam.top;
  if (cam.top) { cam.saved = { pos: cam.pos.clone(), yaw: cam.yaw, pitch: cam.pitch }; cam.pos.set(0, 95, -0.001); }   // the whole arena
  else if (cam.saved) Object.assign(cam, { pos: cam.saved.pos, yaw: cam.saved.yaw, pitch: cam.saved.pitch });
  $('topBtn').classList.toggle('on', cam.top);
}
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
const sinCos = (a) => [Math.sin(a || 0), Math.cos(a || 0)];
const segDist = (x, z, a, b) => {
  const sx = b[0] - a[0], sz = b[1] - a[1], l2 = sx * sx + sz * sz || 1e-9, k = Math.max(0, Math.min(1, ((x - a[0]) * sx + (z - a[1]) * sz) / l2));
  return Math.hypot(a[0] + sx * k - x, a[1] + sz * k - z);
};
const RADIUS = { prop: 0.75, spawn: 1.2, heal: 1.1 };
const LIFTS = new Set(['kit', 'deco', 'block']);   // kinds with a `y` the gizmo moves up and down
function anchorY(e) {
  if (LIFTS.has(e.kind)) return e.y || 0;
  return ['prop', 'spawn', 'heal'].includes(e.kind) ? C.surfaceHeight(e.x, e.z, 99) : 0;
}
// The entry's own surfaces (kit pieces, blocks).
function surfacesOf(e) {
  if (e.kind === 'kit' || e.kind === 'block') return C.SURFACES.filter(s => s.piece === e.id);
  return [];
}
// A kit piece's footprint radius from its bounding box (pieces without colliders: banners, torches, floors at 0).
function kitRadius(e) {
  const b = C.KIT_MODELS[e.model]; if (!b) return 1;
  return Math.max(0.4, Math.hypot(Math.max(-b[0], b[1]), Math.max(-b[4], b[5])) * C.kitScale(e.model) * (e.scale ?? 1));
}
// A rectangle entry (floor, bounds): how far (x, z) is outside it, in metres (0 inside).
function rectOut(e, x, z) {
  const c = Math.cos(e.rotY || 0), n = Math.sin(e.rotY || 0), dx = x - e.x, dz = z - e.z, lx = dx * c - dz * n, lz = dx * n + dz * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - e.w / 2), Math.max(0, Math.abs(lz) - e.d / 2));
}
// How far (x, z) is from the entry, as a fraction of its size (< 1: on it).
function pickScore(e, x, z) {
  // the big rectangles only when nothing else is there (and only from close to their middle or edge)
  if (e.kind === 'floor' || e.kind === 'bounds') { const o = rectOut(e, x, z); return o > 0 ? 1 + o : Math.min(0.999, 0.99 + Math.hypot(x - e.x, z - e.z) / 1e4); }
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
  const r = e.kind === 'kit' ? kitRadius(e) * 0.8 : e.kind === 'deco' ? Math.max(0.6, (e.h || 2) * (e.scale ?? 1) * 0.4) : (RADIUS[e.kind] || 1.5) * (e.scale ?? 1);
  return Math.hypot(x - e.x, z - e.z) / r;
}
function extentRadius(e) {
  if (e.kind === 'floor' || e.kind === 'bounds' || e.kind === 'block') return Math.hypot(e.w, e.d) / 2 * (e.scale ?? 1);
  if (e.kind === 'kit') return kitRadius(e);
  const sf = surfacesOf(e);
  if (sf.length) return Math.max(...sf.map(s => Math.hypot(s.x - e.x, s.z - e.z) + Math.hypot(s.w, s.d) / 2));
  return e.kind === 'deco' ? Math.max(0.8, (e.h || 2) * (e.scale ?? 1) * 0.5) : (RADIUS[e.kind] || 1.5) * (e.scale ?? 1);
}

// ------------------------------------------------------------ overlays (toggles) and markers
const OVERLAYS = { colliders: 'Colliders', surfaces: 'Walkable surfaces', walls: 'Wall boxes (red: no standing)', spawns: 'Spawns', heals: 'Heal spots', props: 'Props',
  rim: 'Arena bounds and rim', labels: 'Selection outline' };
const shown = { colliders: true, surfaces: true, walls: false, spawns: true, heals: true, props: true, rim: true, labels: true };
try { Object.assign(shown, JSON.parse(localStorage.getItem('waEditOverlays') || '{}')); } catch {}
for (const [k, name] of Object.entries(OVERLAYS)) {
  const l = document.createElement('label'); l.className = 'tog';
  l.innerHTML = `<input type="checkbox" ${shown[k] ? 'checked' : ''}> ${name}`;
  l.firstChild.onchange = (ev) => { shown[k] = ev.target.checked; try { localStorage.setItem('waEditOverlays', JSON.stringify(shown)); } catch {} drawOverlays(); };
  $('overlays').appendChild(l);
}
const overlayRoot = new THREE.Group(); helpers.add(overlayRoot);
const lineMat = (color, opacity = 0.9) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
function circlePts(x, z, r, y, n = 24) { const p = []; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; p.push(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r); } return p; }
function lines(pts, color, opacity) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const l = new THREE.LineSegments(g, lineMat(color, opacity)); l.renderOrder = 10; return l; }
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
  if (shown.surfaces) {
    for (const s of C.SURFACES) {
      if (s.noStand && !shown.walls) continue;
      const ramp = s.kind === 'ramp', geo = s.round ? new THREE.CircleGeometry(s.w / 2, 24) : new THREE.PlaneGeometry(s.w, ramp ? Math.hypot(s.d, s.y1 - s.y0) : s.d);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: s.noStand ? 0xff4040 : s.moveOnly ? 0x40c0ff : 0x40ff70, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(s.x, (ramp ? (s.y0 + s.y1) / 2 : s.top) + 0.04, s.z);
      m.rotation.order = 'YXZ'; m.rotation.y = s.yaw || 0;
      if (ramp) m.rotation.x = -Math.atan2(s.y1 - s.y0, s.d);
      m.renderOrder = 9; overlayRoot.add(m);
    }
  }
  if (shown.spawns) C.SPAWN_POINTS.forEach(([x, , z, yaw], i) => {
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0x4ac8ff, depthTest: false, transparent: true });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), mat); post.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 8).rotateX(Math.PI / 2), mat); head.position.set(0, 0.25, 0.9);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 24).rotateX(-Math.PI / 2), mat); ring.position.y = 0.06;
    g.add(post, head, ring); g.position.set(x, 0, z); g.rotation.y = yaw; g.renderOrder = 11; overlayRoot.add(g);
  });
  if (shown.heals) for (const h of C.HEAL_SPOTS) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshBasicMaterial({ color: 0x5aff8a, depthTest: false, transparent: true }));
    m.position.set(h.x, h.y + 0.8, h.z); m.renderOrder = 11; overlayRoot.add(m);
  }
  if (shown.props) C.PROP_SPAWNS.forEach(([type, x, z]) => {
    const m = (propCache[type] ??= makePropMesh(type)).clone();
    m.position.set(x, C.surfaceHeight(x, z, 99), z); overlayRoot.add(m);
  });
  if (shown.rim) {
    const B = C.ARENA_BOUNDS, y = 0.15;
    overlayRoot.add(lines(circlePts(0, 0, C.ARENA_RADIUS, y, 96), 0xff5050, 0.6),
      lines([B.x0, y, B.z0, B.x1, y, B.z0, B.x1, y, B.z0, B.x1, y, B.z1, B.x1, y, B.z1, B.x0, y, B.z1, B.x0, y, B.z1, B.x0, y, B.z0], 0xffd04a, 0.9));
  }
  drawSelection();
}

// ------------------------------------------------------------ selection, the gizmo and dragging
let selection = [];
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
  if (e) {
    proxy.position.set(e.x, anchorY(e), e.z); proxy.rotation.set(0, e.rotY || 0, 0); proxy.scale.setScalar(1);
    gizmo.attach(proxy);
    gizmo.showY = gizmo.mode === 'rotate' || (LIFTS.has(e.kind) && gizmo.mode === 'translate');
    gizmo.showX = gizmo.showZ = gizmo.mode !== 'rotate';
  } else gizmo.detach();
  drawSelection(); inspect();
}
function setMode(mode) {
  gizmo.setMode(mode);
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
  setSelection(selection);
}
for (const b of document.querySelectorAll('[data-mode]')) b.onclick = () => setMode(b.dataset.mode);
function applySnap() {
  const kit = $('snapKit').checked, grid = $('snapGrid').checked;
  gizmo.setTranslationSnap(kit ? C.KIT_GRID / 2 : grid ? 0.25 : null);
  gizmo.setRotationSnap(kit ? Math.PI / 2 : grid ? Math.PI / 12 : null);
  gizmo.setScaleSnap(grid ? 0.05 : null);
}
$('snapKit').onchange = () => { if ($('snapKit').checked) $('snapGrid').checked = false; applySnap(); };
$('snapGrid').onchange = () => { if ($('snapGrid').checked) $('snapKit').checked = false; applySnap(); };
applySnap();
const snapKitXZ = (v) => $('snapKit').checked ? Math.round(v / (C.KIT_GRID / 2)) * (C.KIT_GRID / 2) : v;

// a drag: the selected entries move with the proxy (around the first one), and nearby world objects follow until release
let drag = null;
gizmo.addEventListener('dragging-changed', (ev) => {
  if (ev.value) {
    const e0 = byId(selection[0]);
    drag = { pivot: [e0.x, e0.z], y0: anchorY(e0), start: selection.map(id => structuredClone(byId(id))), carried: carriedObjects() };
    pushUndo();
  } else if (drag) {
    drag = null;
    commit();
  }
});
gizmo.addEventListener('objectChange', () => {
  if (!drag) return;
  const dx = proxy.position.x - drag.pivot[0], dz = proxy.position.z - drag.pivot[1], dy = proxy.position.y - drag.y0;
  const e0s = drag.start[0], dRot = proxy.rotation.y - (e0s.rotY || 0);
  const k = gizmo.mode === 'scale' ? Math.max(0.05, [proxy.scale.x, proxy.scale.y, proxy.scale.z].reduce((m, v) => Math.abs(v - 1) > Math.abs(m - 1) ? v : m, 1)) : 1;   // the axis dragged most
  const c = Math.cos(dRot), s = Math.sin(dRot);
  for (const st of drag.start) {
    const e = byId(st.id); if (!e) continue;
    const rx = st.x - drag.pivot[0], rz = st.z - drag.pivot[1];
    e.x = drag.pivot[0] + dx + rx * c + rz * s;
    e.z = drag.pivot[1] + dz - rx * s + rz * c;
    if ('rotY' in st || dRot) e.rotY = (st.rotY || 0) + dRot;
    if (gizmo.mode === 'scale') { if (k === 1) delete e.scale; else e.scale = (st.scale ?? 1) * k; }
    if (dy && LIFTS.has(e.kind)) e.y = Math.max(0, (st.y || 0) + dy);
    if (e.kind === 'deco' && $('snapGround').checked && !dy) e.y = groundUnder(e.x, e.z);
  }
  // the world objects near the first entry follow the drag (the rebuild on release puts everything in its true place)
  for (const o of drag.carried) {
    const rx = o.start.x - drag.pivot[0], rz = o.start.z - drag.pivot[1];
    o.obj.position.set(drag.pivot[0] + dx + rx * c + rz * s, o.start.y + (drag.y0 !== undefined ? dy : 0), drag.pivot[1] + dz - rx * s + rz * c);
    o.obj.rotation.y = o.rotY + dRot;
  }
  drawSelection(); inspect(true);
});
const tmpBox = new THREE.Box3(), tmpV = new THREE.Vector3();
function carriedObjects() {
  const out = [];
  for (const id of selection) {
    const e = byId(id); if (!e) continue;
    const r = extentRadius(e);
    for (const o of scene.children) {
      if (o === helpers || o.isLight || o.isInstancedMesh || !(o.isGroup || o.isMesh)) continue;
      tmpBox.setFromObject(o);
      if (tmpBox.isEmpty()) continue;
      const size = tmpBox.getSize(tmpV).length();
      if (size > 45) continue;                                   // the ground, the floor decals
      tmpBox.getCenter(tmpV);
      if (Math.hypot(tmpV.x - e.x, tmpV.z - e.z) < Math.max(0.8, r * 0.85) && !out.some(q => q.obj === o)) out.push({ obj: o, start: o.position.clone(), rotY: o.rotation.y });
    }
  }
  return out;
}
const groundUnder = (x, z) => C.surfaceHeight(x, z, 99);

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
  if (now) run(); else commitTimer = setTimeout(run, 30);
}
let dirty = false;

// ------------------------------------------------------------ undo / redo (whole-layout snapshots)
const undo = [], redo = [];
function snapshot() { return JSON.stringify({ entries: L.entries, scatter: L.scatter }); }
function pushUndo() { undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo.length = 0; }
function restore(json) { const s = JSON.parse(json); L.entries = s.entries; L.scatter = s.scatter; commit(); setSelection(selection); }
function doUndo() { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); }
function doRedo() { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); }
$('undoBtn').onclick = doUndo; $('redoBtn').onclick = doRedo;

// ------------------------------------------------------------ picking and placing
const ray = new THREE.Raycaster();
let downAt = null, placing = null;
canvas.addEventListener('pointerdown', (ev) => { if (ev.button === 0) downAt = gizmo.axis ? null : [ev.clientX, ev.clientY]; });   // not a click on the gizmo
canvas.addEventListener('pointerup', (ev) => {
  if (ev.button !== 0 || !downAt || gizmo.dragging) return;
  const moved = Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]); downAt = null;
  if (moved > 5) return;
  const p = pickPoint(ev);
  if (!p) return;
  if (placing) { place(placing, p); return; }
  let best = null, bestScore = 1;
  for (const e of L.entries) { const s = pickScore(e, p.x, p.z); if (s < bestScore) { bestScore = s; best = e; } }
  if (!best) { if (!ev.shiftKey) setSelection([]); return; }
  if (ev.shiftKey) setSelection(selection.includes(best.id) ? selection.filter(id => id !== best.id) : [...selection, best.id]);
  else setSelection([best.id]);
});
function pickPoint(ev) {
  ray.setFromCamera(new THREE.Vector2(ev.clientX / innerWidth * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1), camera);
  const targets = scene.children.filter(o => o !== helpers && !o.isLight);
  for (const h of ray.intersectObjects(targets, true)) {
    if (h.object.userData.grass || h.object.isPoints || h.object.isSprite) continue;
    if (h.object.geometry?.boundingSphere?.radius > 60) break;   // the ground: use the plane below
    return h.point;
  }
  const t = -ray.ray.origin.y / ray.ray.direction.y;
  return t > 0 ? ray.ray.origin.clone().addScaledVector(ray.ray.direction, t) : null;
}

// ------------------------------------------------------------ the palette: what can be placed
// Grouped by kit: Gameplay (spawns, heal spots, props, invisible blocks), Castle (KayKit Dungeon), Village (Quaternius),
// Other models (placed as decos fitted to a height). The search box filters every group by name.
const PALETTE = [
  { group: 'Gameplay', label: 'Spawn', make: () => ({ kind: 'spawn', rotY: 0 }) },
  { group: 'Gameplay', label: 'Heal spot', make: () => ({ kind: 'heal', name: 'heal' }) },
  ...Object.keys(C.PROP_TYPES).map(t => ({ group: 'Gameplay', label: `Prop: ${t}`, make: () => ({ kind: 'prop', type: t }) })),
  { group: 'Gameplay', label: 'Invisible block', make: () => ({ kind: 'block', rotY: 0, w: 2, d: 2, h: 3 }) },
  { group: 'Gameplay', label: 'Stone floor', make: () => ({ kind: 'floor', model: 'castle/floor_tile_large', rotY: 0, w: 10, d: 10, seed: 1 }) },
];
const KIT_GROUPS = { castle: 'Castle (KayKit)', village: 'Village (Quaternius)' };
const SPECIAL_MODELS = new Set(['ram', 'potion', 'ice_wall', 'acid_puddle', 'pine_far', 'oak_far', 'birch_far']);
async function buildPalette() {
  let models = [];
  try { models = await (await fetch('/api/map/models')).json(); } catch {}
  for (const m of Object.keys(C.KIT_MODELS)) PALETTE.push({ group: KIT_GROUPS[m.split('/')[0]] || 'Kit', label: m.split('/')[1].replace(/_/g, ' '), title: m,
    make: () => ({ kind: 'kit', model: m, rotY: 0 }) });
  for (const m of models.filter(m => !m.includes('/') && !SPECIAL_MODELS.has(m))) PALETTE.push({ group: 'Other models', label: m, make: () => ({ kind: 'deco', model: m, rotY: 0, h: 2 }) });
  drawPalette();
}
let palButtons = [];
function drawPalette() {
  const root = $('palette'), q = $('palSearch').value.trim().toLowerCase();
  root.innerHTML = ''; palButtons = [];
  const groups = new Map();
  for (const item of PALETTE) if (!q || item.label.toLowerCase().includes(q) || (item.title || '').toLowerCase().includes(q)) (groups.get(item.group) || groups.set(item.group, []).get(item.group)).push(item);
  for (const [name, items] of groups) {
    const d = document.createElement('details'); d.open = !!q || name === 'Gameplay';
    d.innerHTML = `<summary><b>${name}</b> (${items.length})</summary>`;
    const grid = document.createElement('div'); grid.className = 'grid'; d.appendChild(grid);
    for (const item of items) {
      const b = document.createElement('button'); b.textContent = item.label; b.title = item.title || item.label;
      b.onclick = () => { placing = item; $('placing').style.display = 'block'; for (const x of palButtons) x.classList.toggle('on', x === b); };
      grid.appendChild(b); palButtons.push(b);
    }
    root.appendChild(d);
  }
}
$('palSearch').oninput = drawPalette;
function newId(base) { let i = 1; while (byId(`${base}-${i}`)) i++; return `${base}-${i}`; }
function place(item, p) {
  pushUndo();
  const e = { id: '', ...item.make(), x: +snapKitXZ(p.x).toFixed(4), z: +snapKitXZ(p.z).toFixed(4) };
  e.id = newId(e.kind === 'deco' ? e.model : e.kind === 'kit' ? e.model.split('/')[1] : e.kind === 'prop' ? `prop-${e.type}` : e.kind);
  if (e.kind === 'heal') e.name = e.id;
  // a kit piece lands on what's under the click (a wall-walk, a tower top) when ground snap is on
  if ((e.kind === 'deco' || e.kind === 'kit') && $('snapGround').checked) { const y = groundUnder(e.x, e.z); if (y > 0.01) e.y = +y.toFixed(4); }
  // props keep their ids in order (index + 1): a new prop goes after the last prop
  const lastSame = L.entries.map(q => q.kind).lastIndexOf(e.kind);
  L.entries.splice(lastSame >= 0 ? lastSame + 1 : L.entries.length, 0, e);
  cancelPlacing(); commit(); setSelection([e.id]);
}
function cancelPlacing() { placing = null; $('placing').style.display = 'none'; for (const q of palButtons) q.classList.remove('on'); }

// ------------------------------------------------------------ the inspector: the selected entry's fields
function inspect(live = false) {
  const root = $('inspector');
  if (!selection.length) { root.innerHTML = '<div id="help">Click an asset to select it.</div>'; return; }
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
    if (v === undefined && !['h', 'y'].includes(k) && !(e.kind === 'kit' && k === 'solid')) continue;
    const row = document.createElement('div'); row.className = 'field';
    row.innerHTML = `<span>${k === 'rotY' ? 'rotY (rad)' : k}</span>`;
    const inp = document.createElement('input');
    inp.dataset.k = k; inp.value = typeof v === 'number' ? +v.toFixed(3) : (v ?? '');
    if (typeof v === 'number' || v === undefined) inp.type = 'number', inp.step = k === 'rotY' ? '0.05' : '0.1';
    inp.onchange = () => {
      pushUndo();
      const raw = inp.value, num = inp.type === 'number' ? parseFloat(raw) : null;
      if (k === 'id') { if (!raw || byId(raw)) { inp.value = e.id; return; } e.id = raw; selection = [raw]; }
      else if (inp.type === 'number') { if (!Number.isFinite(num)) return; if (k === 'scale' && num === 1) delete e.scale; else e[k] = num; }
      else e[k] = raw;
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
    if (c.kind === 'kit') { const b = C.KIT_MODELS[c.model], len = b ? (b[1] - b[0]) * C.kitScale(c.model) * (c.scale ?? 1) : 1.5; c.x += Math.cos(c.rotY || 0) * len; c.z -= Math.sin(c.rotY || 0) * len; }
    else { c.x += 1.5; c.z += 1.5; }
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

// Turn the selection a quarter round its first entry, or lift it one storey (a KayKit wall's height), as one undo step.
function nudge({ rot = 0, lift = 0 }) {
  pushUndo();
  const e0 = byId(selection[0]), c = Math.cos(rot), s = Math.sin(rot);
  for (const id of selection) {
    const e = byId(id); if (!e) continue;
    if (rot) { const rx = e.x - e0.x, rz = e.z - e0.z; e.x = +(e0.x + rx * c + rz * s).toFixed(4); e.z = +(e0.z - rx * s + rz * c).toFixed(4); e.rotY = +(((e.rotY || 0) + rot) % (2 * Math.PI)).toFixed(4); }
    if (lift && LIFTS.has(e.kind)) { const y = Math.max(0, (e.y || 0) + lift); if (y < 1e-3) delete e.y; else e.y = +y.toFixed(4); }
  }
  commit(); setSelection(selection);
}

// ------------------------------------------------------------ checks (warnings, not blockers)
function runChecks() {
  const out = [], R = C.ARENA_RADIUS;
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
  for (const e of L.entries) if (['spawn', 'heal', 'prop'].includes(e.kind) && !C.insideArena(e.x, e.z, 0.3)) warn(`${e.id} is outside the arena bounds`, [e.x, e.z]);
  for (const e of L.entries) if (['spawn', 'heal', 'prop'].includes(e.kind)) { const y = C.surfaceHeight(e.x, e.z, 99), s = C.surfaceSolidAt(e.x, y + 0.6, e.z); if (s) warn(`${e.id} is inside ${s.piece || s.name}`, [e.x, e.z]); }
  for (const e of L.entries) if (Math.hypot(e.x, e.z) > R + 25) warn(`${e.id} is far outside the arena`, [e.x, e.z]);
  // platforms with no way up (a walk, a double jump or a double jump plus a ledge grab, from the ground or from a
  // surface that's reachable itself)
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
  const stand = C.SURFACES.filter(s => !s.noStand);
  const sTopAt = (s, x, z) => { if (s.kind !== 'ramp') return s.top; const c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0), lz = (x - s.x) * n + (z - s.z) * c; return s.y0 + (s.y1 - s.y0) * Math.max(0, Math.min(1, lz / s.d + 0.5)); };
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
  const reached = new Set();
  for (let pass = 0, grew = true; grew && pass < 12; pass++) {
    grew = false;
    for (const s of stand) {
      if (reached.has(s)) continue;
      for (const [ex, ez, ox, oz] of edge(s)) {
        const top = sTopAt(s, ex, ez);
        let floor = C.insideArena(ox, oz) ? 0 : -Infinity;                                 // the ground beside it, inside the bounds
        for (const q of reached) if (inside(q, ox, oz, 0.1)) floor = Math.max(floor, sTopAt(q, ox, oz));
        for (const q of reached) if (q !== s && inside(q, ex, ez, 0.1) && Math.abs(sTopAt(q, ex, ez) - top) < step + 0.05) floor = Math.max(floor, top);   // joined to a reached surface
        if (top - floor <= Math.max(step + 0.05, grab)) { reached.add(s); grew = true; break; }
      }
    }
  }
  return stand.filter(s => !reached.has(s) && !s.ladder && s.style !== 'block' && !s.moveOnly);
}

// ------------------------------------------------------------ save, export, import
async function save() {
  const bad = C.validateLayout(L);
  if (bad.length) { status('Not saved: ' + bad[0], 'err'); return; }
  status('Saving…');
  try {
    const res = await fetch('/api/map/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(L) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { status(`Not saved: ${j.error || res.status}`, 'err'); return; }
    dirty = false;
    status(`Saved ${new Date().toLocaleTimeString()} · the server restarts with it; players reload to see it`, 'ok');
  } catch (err) { status('Not saved: ' + err.message, 'err'); }
}
$('saveBtn').onclick = save;
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([C.formatLayout(L)], { type: 'application/json' }));
  a.download = 'layout.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text()), bad = C.validateLayout(j);
    if (bad.length) { status('Not imported: ' + bad[0], 'err'); return; }
    pushUndo(); L.entries = j.entries; L.scatter = j.scatter; commit(); setSelection([]);
    status('Imported (not saved yet)');
  } catch (err) { status('Not imported: ' + err.message, 'err'); }
  ev.target.value = '';
};
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ------------------------------------------------------------ keys
addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  const k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
  if (mod && k === 's') { ev.preventDefault(); save(); return; }
  if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && k === 'y') { ev.preventDefault(); doRedo(); return; }
  if (mod && k === 'd') { ev.preventDefault(); duplicate(); return; }
  if (k === 'shift') keys.add('shift');
  if (looking) { keys.add(k); return; }                       // flying: WASD/QE move the camera
  if (k === 'w') setMode('translate');
  else if (k === 'e') setMode('rotate');
  else if (k === 'r') setMode('scale');
  else if (k === 't') toggleTop();
  else if (k === 'delete' || k === 'backspace') { ev.preventDefault(); remove(); }
  else if ((k === '[' || k === ']') && selection.length) nudge({ rot: k === ']' ? -Math.PI / 2 : Math.PI / 2 });
  else if ((k === 'pageup' || k === 'pagedown') && selection.length) { ev.preventDefault(); nudge({ lift: k === 'pageup' ? C.KIT_GRID * 2 : -C.KIT_GRID * 2 }); }
  else if (k === 'escape') { cancelPlacing(); setSelection([]); }
});
addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
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
window.__edit = { L, C, select: (ids) => setSelection(ids), commit, save, runChecks, cam, gizmo, proxy, get scene() { return scene; }, get selection() { return selection; }, rebuild, status: () => $('status').textContent };
status('Loading the map…');
drawOverlays(); runChecks(); buildPalette();
requestAnimationFrame(frame);
const t0 = performance.now();
rebuild().then(() => status(`Ready · ${L.entries.length} entries · loaded in ${Math.round(performance.now() - t0)} ms`, 'ok'));
