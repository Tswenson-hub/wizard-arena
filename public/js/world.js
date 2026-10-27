// Low-poly arena: ground, pillars, trees, decorative bits, and prop mesh factories.
import * as THREE from 'three';
import * as C from '../shared/constants.js';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0.0, ...extra });

function jitterGeometry(geo, amount) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) + (Math.random() - 0.5) * amount,
      pos.getY(i) + (Math.random() - 0.5) * amount,
      pos.getZ(i) + (Math.random() - 0.5) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const rise = Math.max(0, r - C.ARENA_RADIUS - 2);
  return rise > 0 ? rise * 0.3 + Math.sin(x * 0.35) * Math.cos(z * 0.3) * Math.min(1.5, rise * 0.3) : 0;
}

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x9fc8e8);
  scene.fog = new THREE.Fog(0x9fc8e8, 55, 170);

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x5a7a46, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Ground: a big grid, flat inside the arena and rising into rolling hills outside it.
  const groundGeo = new THREE.PlaneGeometry(240, 240, 72, 72);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, groundHeight(x, z));
    }
    groundGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(groundGeo, flat(0x6fae55));
  ground.receiveShadow = true;
  scene.add(ground);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(C.ARENA_RADIUS + 0.5, 40).rotateX(-Math.PI / 2), flat(0x8f9a86));
  floor.position.y = 0.05;
  floor.receiveShadow = true;
  scene.add(floor);

  const inner = new THREE.Mesh(new THREE.RingGeometry(6, 6.6, 32).rotateX(-Math.PI / 2), flat(0x7b8678));
  inner.position.y = 0.06; inner.receiveShadow = true; scene.add(inner);

  // Arena rim: a ring of low stones.
  const rimMat = flat(0x7d8792);
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const r = C.ARENA_RADIUS + 1.2;
    const s = 0.8 + Math.random() * 0.8;
    const stone = new THREE.Mesh(jitterGeometry(new THREE.DodecahedronGeometry(s, 0), 0.25), rimMat);
    stone.position.set(Math.cos(a) * r, s * 0.4, Math.sin(a) * r);
    stone.rotation.set(Math.random(), Math.random(), Math.random());
    stone.castShadow = stone.receiveShadow = true;
    scene.add(stone);
  }

  // Pillars
  const pillarMat = flat(0xa9b0b8);
  const pillarTop = flat(0x8d949c);
  for (const p of C.PILLARS) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.85, p.r, p.h, 7), pillarMat);
    body.position.y = p.h / 2; body.castShadow = body.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.1, p.r * 0.85, 0.5, 7), pillarTop);
    cap.position.y = p.h + 0.25; cap.castShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.15, p.r * 1.25, 0.4, 7), pillarTop);
    base.position.y = 0.2; base.castShadow = base.receiveShadow = true;
    g.add(body, cap, base);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.random() * Math.PI;
    scene.add(g);
    // a floating rune crystal on the tall ones
    if (p.h >= 4.5) {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: 0x9d6bff, emissive: 0x6a35ff, emissiveIntensity: 1.2, flatShading: true }));
      crystal.position.set(p.x, p.h + 1.3, p.z);
      crystal.userData.spin = true;
      scene.add(crystal);
      spinners.push(crystal);
    }
  }

  // Trees
  const trunkMat = flat(0x7a5230);
  const leafMats = [flat(0x3f8f4f), flat(0x4ea35a), flat(0x2f7a45)];
  for (const t of C.TREES) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 2.2, 6), trunkMat);
    trunk.position.y = 1.1; trunk.castShadow = true;
    g.add(trunk);
    let y = 2.0;
    for (let i = 0; i < 3; i++) {
      const r = 2.2 - i * 0.55;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 2.2, 6), leafMats[i % leafMats.length]);
      cone.position.y = y + 1.1; cone.castShadow = true;
      g.add(cone);
      y += 1.3;
    }
    g.position.set(t.x, 0, t.z);
    g.rotation.y = Math.random() * Math.PI * 2;
    g.scale.setScalar(0.9 + Math.random() * 0.4);
    scene.add(g);
  }

  // Scatter some tufts / small rocks outside the arena for depth
  const tuftMat = flat(0x5d9a48);
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = C.ARENA_RADIUS + 4 + Math.random() * 40;
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.4 + Math.random() * 0.5, 0.6 + Math.random() * 0.8, 4), tuftMat);
    m.position.set(Math.cos(a) * r, groundHeight(Math.cos(a) * r, Math.sin(a) * r) + 0.2, Math.sin(a) * r);
    scene.add(m);
  }

  // Distant mountains
  const mtnMat = flat(0x6a7fa0);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
    const r = 82 + Math.random() * 14;
    const h = 20 + Math.random() * 24;
    const m = new THREE.Mesh(new THREE.ConeGeometry(14 + Math.random() * 10, h, 5), mtnMat);
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    scene.add(m);
  }

  return { sun };
}

export const spinners = [];

// ------------------------------------------------------------ Meshy models
// Optimised copies of the Meshy exports (see tools/optimize-models.sh). Each is a single textured
// mesh centred on the origin, about one unit tall, facing +z.
export const models = { goat: null, potion: null, farmhouse: null };

// Scale a model to `height` metres with its base on y = 0.
function fitModel(gltf, height) {
  const root = gltf.scene;
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(root);
  const k = height / (box.max.y - box.min.y);
  root.scale.setScalar(k);
  root.position.y = -box.min.y * k;
  const holder = new THREE.Group();
  holder.add(root);
  return holder;
}

export function loadModels(loader, scene) {
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  return Promise.all([
    load('/models/goat.glb').then(g => { models.goat = fitModel(g, 1.25); }),
    load('/models/potion.glb').then(g => { models.potion = fitModel(g, C.PROP_TYPES.potion.h); }),
    load('/models/farmhouse.glb').then(g => {
      // The wizard's farmhouse sits on the hillside just past the rim, front door facing the arena.
      const house = fitModel(g, 17);
      const x = 9, z = 48;
      house.position.set(x, groundHeight(x * 0.86, z * 0.86) - 0.4, z);
      house.rotation.y = Math.atan2(-x, -z);
      house.traverse(o => { if (o.isMesh) o.receiveShadow = false; });
      scene.add(house);
      models.farmhouse = house;
    }),
  ]);
}

// ------------------------------------------------------------ props
const propMats = {};
function mat(color) { return propMats[color] ??= flat(color); }

export function makePropMesh(type) {
  const spec = C.PROP_TYPES[type];
  const g = new THREE.Group();
  let m;
  switch (type) {
    case 'crate': {
      m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), mat(spec.color));
      m.position.y = 0.5;
      g.add(m);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.12, 1.06), mat(0x8a5f2e));
      edge.position.y = 0.5; g.add(edge);
      const edge2 = edge.clone(); edge2.rotation.z = Math.PI / 2; g.add(edge2);
      break;
    }
    case 'barrel': {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.15, 8), mat(spec.color));
      m.position.y = 0.575; g.add(m);
      for (const y of [0.25, 0.9]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 8), mat(0x4a4a52));
        band.position.y = y; g.add(band);
      }
      break;
    }
    case 'pumpkin': {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat(spec.color));
      m.scale.set(1, 0.75, 1); m.position.y = 0.38; g.add(m);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.3, 5), mat(0x5a8a3a));
      stem.position.y = 0.8; g.add(stem);
      break;
    }
    case 'rock': {
      m = new THREE.Mesh(jitterGeometry(new THREE.DodecahedronGeometry(0.6, 0), 0.2), mat(spec.color));
      m.position.y = 0.5; m.rotation.set(0.3, 0.6, 0.1); g.add(m);
      break;
    }
    case 'potion': {
      g.add(models.potion ? models.potion.clone() : new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, spec.h, 8), mat(spec.color)));
      if (!models.potion) g.children[0].position.y = spec.h / 2;
      break;
    }
    case 'pot': {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push(new THREE.Vector2(0.15 + Math.sin(t * Math.PI) * 0.32 + (t > 0.85 ? 0.05 : 0), t * 0.9));
      }
      m = new THREE.Mesh(new THREE.LatheGeometry(pts, 8), mat(spec.color));
      g.add(m);
      break;
    }
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.type = type;
  return g;
}

// Pieces thrown around when a prop breaks.
export function makeFragments(type, count = 8) {
  const spec = C.PROP_TYPES[type];
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = 0.12 + Math.random() * 0.22;
    const geo = i % 2 ? new THREE.TetrahedronGeometry(s, 0) : new THREE.BoxGeometry(s, s, s);
    const m = new THREE.Mesh(geo, mat(spec.color));
    m.castShadow = true;
    out.push(m);
  }
  return out;
}
