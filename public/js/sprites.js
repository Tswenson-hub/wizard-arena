// Textured particles: Kenney's Particle Pack (CC0, public/textures/particles) packed at runtime into one atlas and
// drawn as camera-facing quads by two instanced meshes, one additive (fire, sparks, glows, runes) and one alpha-blended
// (smoke, dirt, scorch marks; sorted back to front). Every particle is pooled: no meshes or materials per particle.
//
// spawn(name, opts) -> the particle (or null when the pool is full). opts:
//   p [x,y,z] | Vector3, v [vx,vy,vz], grav (m/s², + pulls down), drag (per second), life (s),
//   size (m) or size: [start, end], aspect (height/width), rot, spin (rad/s), color hex, alpha (peak),
//   fadeIn (share of life), add (additive, default true), mode: 'face' | 'streak' (stretched along v, or along `axis`)
//   | 'flat' (lying on the ground), axis [x,y,z], stretch (extra length per m/s in streak mode), follow (Object3D),
//   offset [x,y,z] (with follow), floor (stop at y = floor), optional (dropped first in ?low).
import * as THREE from 'three';

const BIG = ['smoke_01', 'smoke_07', 'smoke_08', 'smoke_10', 'magic_01', 'magic_02', 'scorch_01', 'twirl_01'];
const SMALL = ['circle_02', 'circle_05', 'light_01', 'light_03', 'magic_03', 'magic_05', 'star_01', 'star_06', 'star_09',
  'spark_01', 'spark_02', 'flame_01', 'flame_03', 'fire_01', 'fire_02', 'muzzle_01', 'muzzle_02', 'dirt_01', 'dirt_02',
  'scorch_02', 'slash_01', 'scratch_01', 'twirl_02', 'trace_01', 'window_04'];
const DIR = './textures/particles/';
const ATLAS = 1024;   // big sprites: 256 px in the top two rows (4 a row); small ones: 128 px below (8 a row)

const RECT = {}, UV = {};   // canvas cell [x, y, size] and texture [u0, v0, u1, v1]
BIG.forEach((n, i) => { RECT[n] = [(i % 4) * 256, Math.floor(i / 4) * 256, 256]; });
SMALL.forEach((n, i) => { RECT[n] = [(i % 8) * 128, 512 + Math.floor(i / 8) * 128, 128]; });
// a texel of inset against bleeding; canvas y runs down, and the texture's flipY puts canvas row 0 at v = 1
for (const n in RECT) { const [x, y, s] = RECT[n], e = 1; UV[n] = [(x + e) / ATLAS, 1 - (y + s - e) / ATLAS, (x + s - e) / ATLAS, 1 - (y + e) / ATLAS]; }
export const SPRITE_NAMES = Object.keys(UV);

const VERT = `
attribute vec3 iPos; attribute vec2 iSize; attribute float iRot; attribute vec4 iColor; attribute vec4 iUV;
attribute vec3 iAxis; attribute float iMode;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vUv = mix(iUV.xy, iUV.zw, uv);
  vColor = iColor;
  vec2 c = position.xy;
  float cs = cos(iRot), sn = sin(iRot);
  vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * iSize;
  vec4 mv;
  if (iMode < 0.5) {                       // facing the camera
    mv = viewMatrix * vec4(iPos, 1.0); mv.xy += r;
  } else if (iMode < 1.5) {                // a streak: long along its axis (in view), facing the camera
    vec3 ax = (viewMatrix * vec4(iAxis, 0.0)).xyz;
    vec2 a2 = length(ax.xy) > 1e-4 ? normalize(ax.xy) : vec2(0.0, 1.0);
    vec2 side = vec2(-a2.y, a2.x);
    mv = viewMatrix * vec4(iPos, 1.0); mv.xy += a2 * c.y * iSize.y + side * c.x * iSize.x;
  } else {                                 // flat on the ground
    mv = viewMatrix * vec4(iPos + vec3(r.x, 0.0, -r.y), 1.0);   // -y: keeps the winding facing up (front faces only)
  }
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * t.r, a);
}`;

class Layer {
  constructor(scene, tex, max, additive) {
    this.max = max; this.list = [];
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    const attr = (name, n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.a = { pos: attr('iPos', 3), size: attr('iSize', 2), rot: attr('iRot', 1), color: attr('iColor', 4), uv: attr('iUV', 4), axis: attr('iAxis', 3), mode: attr('iMode', 1) };
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 11;
    this.geo = g;
    scene.add(this.mesh);
  }
}

const tmp = new THREE.Vector3();
export class SpriteFX {
  constructor(scene, { low = false } = {}) {
    this.low = low;
    const c = document.createElement('canvas'); c.width = c.height = ATLAS;
    this.ctx = c.getContext('2d');
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.generateMipmaps = true; this.tex.minFilter = THREE.LinearMipmapLinearFilter; this.tex.magFilter = THREE.LinearFilter;
    this.tex.anisotropy = 2;
    // the files arrive one by one; the atlas updates as they do (a sprite whose cell is empty just doesn't show yet)
    for (const n of SPRITE_NAMES) {
      const img = new Image();
      img.onload = () => {
        const [x, y, s] = RECT[n];
        this.ctx.drawImage(img, x, y, s, s);
        this.tex.needsUpdate = true;
      };
      img.src = DIR + n + '.png';
    }
    const max = low ? 900 : 3200;
    this.add = new Layer(scene, this.tex, max, true);
    this.norm = new Layer(scene, this.tex, Math.round(max * 0.5), false);
  }

  alive() { return this.add.list.length + this.norm.list.length; }

  spawn(name, o = {}) {
    if (this.low && o.optional && Math.random() < 0.55) return null;
    const L = o.add === false ? this.norm : this.add;
    if (L.list.length >= L.max) return null;
    const uv = UV[name] || UV.circle_05;
    const P = o.p || [0, 0, 0], V = o.v || [0, 0, 0];
    const px = P.x ?? P[0], py = P.y ?? P[1], pz = P.z ?? P[2];
    const size = o.size ?? 0.5;
    const hex = o.color ?? 0xffffff;   // raw display values: the shader writes them straight out, like the hex looks
    const part = {
      uv, x: px, y: py, z: pz, vx: V.x ?? V[0], vy: V.y ?? V[1], vz: V.z ?? V[2],
      grav: o.grav ?? 0, drag: o.drag ?? 0, age: 0, life: o.life ?? 0.5,
      s0: Array.isArray(size) ? size[0] : size, s1: Array.isArray(size) ? size[1] : size, aspect: o.aspect ?? 1,
      rot: o.rot ?? Math.random() * Math.PI * 2, spin: o.spin ?? 0,
      r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255, alpha: o.alpha ?? 1, fadeIn: o.fadeIn ?? 0.08, fadePow: o.fadePow ?? 1,
      mode: o.mode === 'streak' ? 1 : o.mode === 'flat' ? 2 : 0, axis: o.axis || null, stretch: o.stretch ?? 0,
      follow: o.follow || null, off: o.offset || [0, 0, 0], floor: o.floor ?? null, dead: false,
    };
    L.list.push(part);
    return part;
  }

  update(dt, camera) {
    for (const L of [this.add, this.norm]) {
      const list = L.list;
      for (let i = list.length - 1; i >= 0; i--) {
        const q = list[i];
        q.age += dt;
        if (q.dead || q.age >= q.life || (q.follow && !q.follow.parent)) { list[i] = list[list.length - 1]; list.pop(); continue; }
        if (q.follow) {
          q.follow.getWorldPosition(tmp); q.x = tmp.x + q.off[0]; q.y = tmp.y + q.off[1]; q.z = tmp.z + q.off[2];
        } else {
          if (q.drag) { const k = Math.max(0, 1 - q.drag * dt); q.vx *= k; q.vy *= k; q.vz *= k; }
          q.vy -= q.grav * dt;
          q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
          if (q.floor != null && q.y < q.floor) { q.y = q.floor; q.vy = 0; q.vx *= 0.8; q.vz *= 0.8; }
        }
        q.rot += q.spin * dt;
      }
      // smoke and dirt draw back to front
      if (L === this.norm && camera && list.length > 1) {
        const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
        for (const q of list) q.d = (q.x - cx) ** 2 + (q.y - cy) ** 2 + (q.z - cz) ** 2;
        list.sort((a, b) => b.d - a.d);
      }
      const A = L.a;
      for (let i = 0; i < list.length; i++) {
        const q = list[i], k = q.age / q.life;
        const s = q.s0 + (q.s1 - q.s0) * (1 - (1 - k) * (1 - k));                  // eases out toward the end size
        const fade = (k < q.fadeIn ? k / q.fadeIn : 1) * Math.pow(1 - Math.max(0, (k - q.fadeIn) / (1 - q.fadeIn)), q.fadePow);
        A.pos.array.set([q.x, q.y, q.z], i * 3);
        let w = s, h = s * q.aspect;
        if (q.mode === 1) {
          const ax = q.axis || [q.vx, q.vy, q.vz];
          A.axis.array.set(ax, i * 3);
          if (q.stretch) h += Math.hypot(q.vx, q.vy, q.vz) * q.stretch;
        }
        A.size.array[i * 2] = w; A.size.array[i * 2 + 1] = h;
        A.rot.array[i] = q.rot;
        A.color.array.set([q.r, q.g, q.b, q.alpha * fade], i * 4);
        A.uv.array.set(q.uv, i * 4);
        A.mode.array[i] = q.mode;
      }
      for (const k in A) { A[k].needsUpdate = true; A[k].clearUpdateRanges?.(); A[k].addUpdateRange?.(0, list.length * A[k].itemSize); }
      L.geo.instanceCount = list.length;
    }
  }
}
