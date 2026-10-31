// A wizard in the scene: cloned skinned model, animation state machine, nameplate, colour ring.
import * as THREE from 'three';
import { makeWizardBody, botBody, BONES, BODY_TOP } from './looks.js';
import { FLIPS, PHASES } from './spellanim.js';
import * as C from '../shared/constants.js';

// Shared telekinesis visuals: glowing motes along the beam and a shell around the held prop.
const TK_COLOR = 0xb48cff;
const moteGeo = new THREE.IcosahedronGeometry(1, 0);
const moteMat = new THREE.MeshBasicMaterial({ color: 0xd9c4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
const BEAM_MOTES = 12;

// An energy bubble (round 14, instead of the wireframe balls): a bright fresnel rim, a faint fill, and slow ripples
// drifting up its surface. Additive, so it only ever lightens what's behind it. `opacity` fades the whole bubble.
const bubbleGeo = new THREE.SphereGeometry(1, 40, 24);
function bubbleMaterial(color, { opacity = 0, fill = 0.07, rim = 1, ripple = 0.25, whiten = 0.35 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity }, fill: { value: fill }, rim: { value: rim },
      ripple: { value: ripple }, whiten: { value: whiten }, time: { value: 0 }, hit: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() { vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float opacity, fill, rim, ripple, whiten, time, hit; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float edge = pow(f, 3.0) * rim + pow(f, 1.4) * 0.18;
        float waves = 0.5 + 0.5 * sin(vP.y * 9.0 - time * 2.6 + sin(atan(vP.z, vP.x) * 3.0 + time * 0.7) * 1.2);
        float a = fill + edge + waves * waves * ripple * (0.25 + f) + hit * (0.25 + f * 0.6);
        gl_FragColor = vec4(mix(color, vec3(1.0), clamp(edge * whiten + hit * 0.4, 0.0, 0.6)) * a * opacity, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
const shellMat = bubbleMaterial(TK_COLOR, { opacity: 0.9, fill: 0.05, rim: 0.9, ripple: 0.18 });

const CYC = C.SPELLBOOK.cyclone, LASH = C.SPELLBOOK.sanguine_lash;
// Natural ground speed (m/s) of each locomotion clip at 1x, so playback = actual speed / natural speed and the
// feet don't slide. looks.js measures each body's clips (clip.userData.speed); these are the fallbacks.
const NATURAL_SPEED = { run: 4.6, walk_fight: 1.5, back: 1.2, crouch_walk: 1.0, strafe_left: 3.5, strafe_right: 3.5 };
// The ward bubble around the body (round 15, the KayKit Mage with its hat): radius, half-height and centre height (m).
const WARD = { r: 1.25, h: 1.3, y: 1.05 };
// Normal movement is a walk (Ty): the fight walk forward and sideways, the backward walk backward, each time-scaled
// to the ground speed by its measured gait speed. 'run' only plays for a body without the fight walk.

// Round 13: casting on the move. A cast that doesn't root plays on the upper body while the legs keep walking: each
// is a copy of its clip with only its own bones' tracks (LEG_BONES: the hips and legs; everything else is upper body),
// so every bone has exactly one action driving it. Whole-body moves never split (jumps, flips, rolls, falls, hits).
const LEG_BONES = new Set([BONES.root, BONES.hips, ...BONES.legs]);
const WHOLE_BODY = /^(jump|double_jump|land|roll|dash|death|stun|knockdown|getup|hit_waist|mrain_|ride|spin|arrival|flask_step|float|lash|ult$|air_cast|crouch|smoke_screen|blink|mirror_step|skyward|spawn|ledge_climb)/;
// Looping clips (every other key plays once and holds its last frame until the one-shot ends).
const LOOPS = new Set(['idle', 'run', 'walk', 'walk_fight', 'back', 'strafe_left', 'strafe_right', 'crouch', 'crouch_walk', 'block', 'shroud', 'cast_heavy', 'float', 'ride', 'spin']);
// Round 15: main.js's older calls into the Meshy clips by offset (oneShot('cast_heavy', d, 1.5, 1.9) and the like), translated to
// the named phases (spellanim.js PHASES) until main.js calls pose() itself.
function legacyPhase(name, timeScale, startAt) {
  if (timeScale === 1 && startAt === 0) return null;
  if (name === 'cast_fast') return 'cast';
  if (name === 'cast_heavy') return startAt >= 1.5 ? 'cast_release' : 'windup';
  if (name === 'stun') return timeScale >= 2 ? 'flinch' : 'bound';
  if (name === 'dash') return 'dash';
  return null;
}
// Landings and flips may cut these short (an air cast, a flip, an air roll); anything else playing at touchdown goes on.
const LANDABLE = /^(jump|double_jump|float|air_cast|roll_air)/;

// Sanguine Lash: the whip coiling around the caster during the wind-up (a helix of blood-red light).
const coilGeo = (() => {
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const k = i / 120, a = k * Math.PI * 2 * 3.2;
    const r = 0.55 + Math.sin(k * Math.PI) * 0.25;
    pts.push(new THREE.Vector3(Math.sin(a) * r, 0.15 + k * 1.9, Math.cos(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.035, 5, false);
})();
const coilMat = new THREE.MeshBasicMaterial({ color: 0xff2a3c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
// Bound wizards: crimson chain rings around the body.
const chainGeo = new THREE.TorusGeometry(0.62, 0.045, 5, 28);
const chainMat = new THREE.MeshBasicMaterial({ color: 0xff3048, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const linkGeo = new THREE.OctahedronGeometry(0.08, 0);
// Slowed wizards: frost crystals around the legs.
const frostGeo = new THREE.ConeGeometry(0.07, 0.42, 4);
const frostMat = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });

// Arcane Cyclone telegraph: a purple runic circle drawn once on a canvas, shared by every wizard.
let runeTex = null;
function runeTexture() {
  if (runeTex) return runeTex;
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  g.strokeStyle = '#e6c8ff'; g.fillStyle = '#e6c8ff'; g.lineCap = 'round';
  g.shadowColor = '#b46cff'; g.shadowBlur = 14;
  const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  ring(246, 7); ring(226, 3); ring(150, 4); ring(70, 3);
  // rune glyphs between the outer rings: a few strokes each, from a fixed seed so it never flickers
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 18; i++) {
    g.save(); g.rotate(i / 18 * Math.PI * 2); g.translate(0, -188); g.lineWidth = 4;
    g.beginPath();
    for (let k = 0; k < 3; k++) { g.moveTo((rnd() - 0.5) * 22, (rnd() - 0.5) * 26); g.lineTo((rnd() - 0.5) * 22, (rnd() - 0.5) * 26); }
    g.stroke(); g.restore();
  }
  // a star inside
  g.lineWidth = 3; g.beginPath();
  for (let i = 0; i <= 7; i++) { const a = i * 3 / 7 * Math.PI * 2; g[i ? 'lineTo' : 'moveTo'](Math.sin(a) * 150, -Math.cos(a) * 150); }
  g.stroke();
  runeTex = new THREE.CanvasTexture(c);
  runeTex.colorSpace = THREE.SRGBColorSpace;
  return runeTex;
}

// Soft dark disc under an airborne wizard, so everyone can see where they'll land.
let shadowTex = null;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(20,0,40,0.75)'); grad.addColorStop(0.6, 'rgba(20,0,40,0.35)'); grad.addColorStop(1, 'rgba(20,0,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return (shadowTex = new THREE.CanvasTexture(c));
}

function makeNameplate(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 56px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(name, 256, 64);
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fillText(name, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.4, 0.6, 1);
  sp.renderOrder = 10;
  return sp;
}

export class Wizard {
  constructor(info, scene, isLocal) {
    this.id = info.id; this.name = info.name; this.color = info.color; this.isLocal = isLocal;
    this.bot = info.bot || null;
    this.scene = scene;
    this.group = new THREE.Group();
    // round 11: the generic wizard, its look by the loadout's spell mix (looks.js); `voice` picks the grunts
    this.loadout = C.sanitizeLoadout(info.loadout) || { ...C.DEFAULT_LOADOUT };
    this.voice = C.sanitizeVoice(info.voice);
    // round 15: players are the KayKit Mage; bots are Skeletons (the snapshot's `body`, else one picked from the bot's name)
    this.bodyKind = info.body || (info.bot ? botBody(info.name ?? info.id) : 'mage');
    const body = makeWizardBody(this.loadout, { body: this.bodyKind });
    const clips = body.clips;
    this.body = body;   // looks.js: optional extras such as Vesper's setWhip / setWhipGlow
    this.model = body.model;
    this.group.add(this.model);
    scene.add(this.group);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [k, clip] of Object.entries(clips)) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true; a.setEffectiveWeight(0); a.play();
      this.actions[k] = a;
    }
    for (const [k, a] of Object.entries(this.actions)) {
      if (LOOPS.has(k) || a.getClip().userData?.loop) continue;
      a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true;
    }

    this.current = null;
    this.oneShotUntil = 0;
    this.setBase('idle', 0);

    // colour ring at the feet
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.75, depthWrite: false }));
    ring.position.y = 0.04;
    this.group.add(ring);
    this.ring = ring;

    // ward (block) bubble: round 15, around the KayKit body and its hat (2.2 m) and the staff held out in front
    this.ward = new THREE.Mesh(bubbleGeo, bubbleMaterial(0x6cd0ff));
    this.ward.scale.set(WARD.r, WARD.h, WARD.r);
    this.ward.position.y = WARD.y;
    this.ward.visible = false;
    this.group.add(this.ward);
    // Black Death has its own look: a black shroud (an opaque dark core) inside a crimson rim instead of the blue bubble
    this.guardStyle = this.loadout.guard;
    if (this.guardStyle === 'black_death') {
      const u = this.ward.material.uniforms;
      u.color.value.setHex(0x90081c); u.fill.value = 0; u.rim.value = 1.1; u.ripple.value = 0.35; u.whiten.value = 0.04;
      this.wardFill = new THREE.Mesh(bubbleGeo, new THREE.MeshBasicMaterial({ color: 0x040006, transparent: true, opacity: 0, depthWrite: false }));
      this.wardFill.scale.set(WARD.r * 0.98, WARD.h * 0.98, WARD.r * 0.98);
      this.wardFill.position.y = WARD.y;
      this.wardFill.visible = false;
      this.wardFill.renderOrder = 5;
      this.ward.renderOrder = 6;
      this.group.add(this.wardFill);
    }

    // charge glow at the staff head (body.tip: the staff's head on the Mage, the weapon's end on a skeleton); `hand` is the right
    // hand slot, `head` the head bone
    this.hand = body.hand || this.model;
    this.head = body.head || this.model;
    this.tip = body.tip || this.hand;
    this.chargeOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1),
      new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0.9 }));
    this.chargeOrb.visible = false;
    scene.add(this.chargeOrb);
    this.chargeLight = new THREE.PointLight(0xff7a2a, 0, 7);
    scene.add(this.chargeLight);

    // Arcane Cyclone: runic circle on the ground during the wind-up, then a two-turn spin
    this.rune = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: runeTexture(), color: 0x9a50ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.rune.visible = false; this.rune.renderOrder = 2;
    scene.add(this.rune);
    this.cycloneT = -1;          // seconds since the wind-up began; -1 = no cyclone
    this.spinT = -1;             // seconds into the spin; -1 = not spinning

    // landing shadow + ring while airborne (Skyward Flash)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    const landRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc890ff, transparent: true, opacity: 0.6, depthWrite: false }));
    landRing.position.y = 0.01;
    this.shadow.add(landRing);
    this.shadow.visible = false;
    scene.add(this.shadow);

    // Sanguine Lash wind-up coil, bind chains (with a crimson rune underfoot), frost when slowed
    this.coil = new THREE.Mesh(coilGeo, coilMat.clone());
    this.coil.visible = false;
    this.group.add(this.coil);
    this.lashT = -1;             // seconds into our lash wind-up; -1 = none
    this.chains = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(chainGeo, chainMat);
      ring.position.y = 0.45 + i * 0.5;
      ring.rotation.x = Math.PI / 2 + (i - 1) * 0.35;
      for (let k = 0; k < 8; k++) {
        const link = new THREE.Mesh(linkGeo, chainMat);
        const a = k / 8 * Math.PI * 2;
        link.position.set(Math.sin(a) * 0.62, Math.cos(a) * 0.62, 0);
        ring.add(link);
      }
      this.chains.add(ring);
    }
    const bindRune = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: runeTexture(), color: 0xff2040, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    bindRune.position.y = 0.13;
    this.chains.add(bindRune);
    this.chains.visible = false;
    this.group.add(this.chains);
    this.frost = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(frostGeo, frostMat);
      const a = i / 9 * Math.PI * 2;
      c.position.set(Math.sin(a) * 0.38, 0.12 + (i % 3) * 0.16, Math.cos(a) * 0.38);
      c.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6);
      this.frost.add(c);
    }
    this.frost.visible = false;
    this.group.add(this.frost);
    // Frostfall: frozen solid in a block of ice
    this.ice = new THREE.Group();
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x4aa8e0, emissiveIntensity: 0.35, roughness: 0.1, transparent: true, opacity: 0.5, flatShading: true, depthWrite: false });
    const block = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), iceMat);
    block.scale.set(1, 1.45, 1); block.position.y = 0.95;
    this.ice.add(block);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      const sh = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 4), iceMat);
      sh.position.set(Math.sin(a) * 0.62, 0.25 + (i % 2) * 0.9, Math.cos(a) * 0.62);
      sh.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
      this.ice.add(sh);
    }
    this.ice.visible = false;
    this.group.add(this.ice);
    // Tempest Veil: a translucent wind sphere with violet-white streaks whirling around it
    this.veil = new THREE.Group();
    this.veilShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 2),
      new THREE.MeshBasicMaterial({ color: 0xd8c8ff, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
    this.veil.add(this.veilShell);
    this.veilStreaks = [];
    for (let i = 0; i < 7; i++) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(1.25 + (i % 3) * 0.06, 0.022, 4, 36, 1.4 + (i % 2) * 0.8),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xf2ecff : 0xb98cff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
      const pivot = new THREE.Group();
      pivot.rotation.set((i * 0.9) % Math.PI, i * 1.3, (i * 0.5) % 1.2);
      pivot.add(arc);
      this.veil.add(pivot);
      this.veilStreaks.push({ arc, speed: 3 + (i % 3) * 1.5 });
    }
    this.veil.position.y = 1.0;
    this.veil.visible = false;
    this.group.add(this.veil);
    this.veiled = false; this.veilFlashT = 0;
    this.frozen = false;
    this.bound = false; this.slowed = false; this.lashing = false;

    this.nameplate = makeNameplate(this.bot ? `${info.name} · ${this.bot}` : info.name, info.color);
    this.nameplate.position.y = BODY_TOP + 0.4;
    this.nameplate.visible = !isLocal;
    this.group.add(this.nameplate);

    // remote health bar
    this.hpBar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false }));
    this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.09), new THREE.MeshBasicMaterial({ color: 0xff5c6a, depthTest: false }));
    this.hpBar.add(bg, this.hpFill);
    this.hpBar.position.y = BODY_TOP + 0.17;
    this.hpBar.renderOrder = 11; bg.renderOrder = 11; this.hpFill.renderOrder = 12;
    this.hpBar.visible = !isLocal;
    this.group.add(this.hpBar);

    // state mirrored from the server
    this.hp = 100; this.st = 100; this.blocking = false; this.charging = false; this.dead = false; this.stunned = false;
    this.carrying = null; this.kills = 0; this.deaths = 0;
    this.carryMesh = null;
    this.carry = null;           // { holder, liftFrom, t } while a prop floats beside us

    // telekinesis beam from the staff hand to the held prop
    this.beam = new THREE.Group();
    for (let i = 0; i < BEAM_MOTES; i++) this.beam.add(new THREE.Mesh(moteGeo, moteMat));
    this.beam.visible = false;
    scene.add(this.beam);

    // interpolation targets for remote wizards
    this.targetPos = new THREE.Vector3(info.p[0], info.p[1], info.p[2]);
    this.group.position.copy(this.targetPos);
    this.targetYaw = info.yaw || 0;
    this.group.rotation.y = this.targetYaw;
    this.netAnim = 'idle';
    this.chargeT = 0;
    this.fadeT = 0;
    this.dissolve = 0;
  }

  // Looping base state.
  setBase(name, fade = 0.15) {
    if (this.current === name) return;
    const next = this.actions[name];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : null;
    this.current = name;
    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    if (prev) { prev.crossFadeTo(next, fade, false); }
    else next.fadeIn(fade);
  }

  // Short interrupt (cast, flinch, blink) that returns to the base state afterwards.
  // `raw`: play `name` as given (pose() does: its own keys are never translated back into phases, or a fitted `stun` loops).
  oneShot(name, duration, timeScale = 1, startAt = 0, raw = false) {
    const ph = !raw && legacyPhase(name, timeScale, startAt);
    if (ph) return this.pose(ph, duration);
    // round 13: a cast in the air plays the air strike (knees tucked) instead of its ground clip; not a rooting wind-up,
    // which hangs the caster in its own pose (hovering)
    if (this.actions.air_cast && duration <= 1.2 && !WHOLE_BODY.test(name) && !this.castRooted && !this.hovering && !this.dead
      && (this.inAir ?? this.group.position.y > 0.3)) { name = 'air_cast'; duration = 0.45; timeScale = 1; startAt = 0; }
    const a = this.actions[name];
    if (!a) return;
    if (this.layered) this.unsplit(false, !WHOLE_BODY.test(name));
    const prev = this.current ? this.actions[this.current] : null;
    a.reset(); a.time = startAt; a.setEffectiveTimeScale(timeScale); a.setEffectiveWeight(1);
    if (prev && prev !== a) prev.crossFadeTo(a, 0.08, false);
    else a.fadeIn(0.08);
    this.current = name;
    this.oneShotUntil = performance.now() / 1000 + duration;
    const f = FLIPS[name];
    this.flip = f ? { ...f, t: 0 } : null;
  }

  // Round 15: a named animation phase (spellanim.js PHASES: cast, cast_release, windup, flinch, stagger, bound, dash, block_tap,
  // summon, throw, drink, ledge_climb, tk_lift, tk_throw, arrival, taunt, spawn), held `duration` s (its default if omitted).
  // `fit`: stretch the clip to the duration (a wind-up; PHASES sets it where it's the norm). False if this body lacks the phase.
  pose(name, duration, { fit } = {}) {
    const ph = PHASES[name], a = ph && this.actions[ph.key];
    if (!a) return false;
    const d = duration ?? ph.dur, clipLen = a.getClip().duration;
    this.oneShot(ph.key, d, (fit ?? ph.fit) ? clipLen / Math.max(0.05, d) : 1, 0, true);
    return true;
  }

  // The upper-body ('up') or legs ('legs') copy of a clip's action, made the first time it's asked for.
  part(name, which) {
    const key = `${name}^${which}`;
    if (this.actions[key]) return this.actions[key];
    const src = this.actions[name];
    if (!src) return null;
    const clip = src.getClip().clone();
    clip.tracks = clip.tracks.filter(t => LEG_BONES.has(t.name.split('.')[0]) === (which === 'legs'));
    const a = this.mixer.clipAction(clip);
    a.setLoop(src.loop, Infinity); a.clampWhenFinished = src.clampWhenFinished;
    a.enabled = true; a.setEffectiveWeight(0); a.play();
    return (this.actions[key] = a);
  }

  // Split the playing cast: its upper half carries on, the legs walk (`loco`'s legs, faded in).
  split(loco) {
    const full = this.actions[this.current], up = this.part(this.current, 'up');
    if (!full || !up) return;
    up.stopFading(); up.enabled = true; up.time = full.time; up.paused = full.paused;
    up.setEffectiveTimeScale(full.getEffectiveTimeScale()); up.setEffectiveWeight(1);
    full.stopFading(); full.fadeOut(0.15);       // the upper body is the same pose in both, so only the legs blend
    this.layered = { name: this.current, up, legs: null };
    this.walkLegs(loco);
  }

  // The legs under a split cast: `loco`'s legs (idle's when standing), cross-faded when it changes. Legs kept from
  // the shot before (a primary's next shot) carry on in stride.
  walkLegs(loco) {
    const L = this.layered, legs = this.part(loco, 'legs');
    if (!legs || L.legs === legs) return;
    if (L.legs) L.legs.fadeOut(0.15);
    if (this.heldLegs === legs) { legs.stopFading(); legs.setEffectiveWeight(1); }
    else { legs.stopFading(); legs.reset(); legs.enabled = true; legs.setEffectiveWeight(1); legs.fadeIn(0.15); }
    L.legs = legs;
    this.heldLegs = null;
  }

  // Back to whole-body clips. `keep`: the cast goes on (we stopped or left the ground), so its full clip takes the legs
  // back. `holdLegs`: a new cast is starting; the walking legs keep going for a frame in case it splits too.
  unsplit(keep, holdLegs) {
    const L = this.layered;
    if (!L) return;
    const full = this.actions[L.name];
    if (keep && full) { full.stopFading(); full.time = L.up.time; full.setEffectiveWeight(1); }
    L.up.stopFading(); L.up.fadeOut(0.15);
    if (L.legs && holdLegs) this.heldLegs = L.legs;
    else if (L.legs) { L.legs.stopFading(); L.legs.fadeOut(0.15); }
    this.layered = null;
  }

  // Each frame: split the cast in progress while we move on the ground; rejoin it when it ends or we leave the ground.
  updateSplit(m) {
    const name = this.inOneShot() ? this.current : null;
    const ok = name && !this.dead && !WHOLE_BODY.test(name) && !this.castRooted && !this.riding && !(this.inAir ?? this.group.position.y > 0.3);
    if (this.layered && this.layered.name !== name) this.unsplit(false);       // the cast ended
    const loco = ok ? this.locomotion(m, false) : null;
    if (!this.layered) { if (loco) this.split(loco); }
    else if (!ok) this.unsplit(true);
    else this.walkLegs(loco || 'idle');                                         // stopped mid-cast: the legs stand
    if (this.heldLegs) { this.heldLegs.fadeOut(0.15); this.heldLegs = null; }  // the new cast didn't split
    const legs = this.layered?.legs;
    if (legs) {
      const base = Object.keys(NATURAL_SPEED).find(k => this.actions[`${k}^legs`] === legs);
      const n = base && (this.actions[base].getClip().userData?.speed || NATURAL_SPEED[base]);
      legs.setEffectiveTimeScale(n ? Math.min(6, Math.max(0.3, m.speed / n)) : 1);
    }
  }

  inOneShot() { return performance.now() / 1000 < this.oneShotUntil; }

  // Round 10: knocked down by a thrown object: fall, lie there, get up. The characters agent's knockdown / getup clips
  // (each death clip's first part, and reversed) when this body has them, else a long stun.
  knockDown(K) {
    clearTimeout(this.getupTimer);
    const kd = this.actions.knockdown, gu = this.actions.getup;
    if (!kd || !gu) { this.oneShot('stun', K.total, 1.2, 0); return; }
    this.oneShot('knockdown', K.fall + K.down, kd.getClip().duration / K.fall, 0);   // the fall in K.fall s, then held (clamped)
    this.getupTimer = setTimeout(() => { if (!this.dead) this.oneShot('getup', K.getup, gu.getClip().duration / K.getup, 0); }, (K.fall + K.down) * 1000);
  }

  // A body with its own lash clip (Vesper) plays it from the start: the strike lands on the 1.5 s release.
  // Smoke Screen: hidden from a viewer outside the cloud. Fades the body, ring, nameplate and health bar.
  setHidden(hidden, dt) {
    const want = hidden ? 1 : 0;
    const k = this.hideK ?? 0;
    if (k === want) { this.hideAt = undefined; return; }
    // a quick linear fade on the real clock (0.2 s), whatever the frame rate
    const t = performance.now() / 1000, real = Math.min(0.5, t - (this.hideAt ?? t)); this.hideAt = t;
    this.hideK = want > k ? Math.min(1, k + real * 5) : Math.max(0, k - real * 5);
    const vis = 1 - this.hideK;
    this.model.traverse(o => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.userData.baseOpacity === undefined) { m.userData.baseOpacity = m.opacity; m.userData.baseTransparent = m.transparent; }
        m.transparent = m.userData.baseTransparent || vis < 1;
        m.opacity = m.userData.baseOpacity * vis;
      }
    });
    this.ring.material.opacity = (this.dead ? 0.1 : 0.75) * vis;
    this.nameplate.material.opacity = vis;
    for (const c of this.hpBar.children) c.material.opacity = (c === this.hpFill ? 1 : 0.6) * vis;
    this.group.visible = this.hideK < 0.98;
    if (this.carry) this.carry.holder.visible = this.group.visible;
    if (!this.group.visible) this.beam.visible = false;
  }

  // an absorbed hit makes the veil flash
  veilFlash() { this.veilFlashT = 0.25; }

  startLash() { this.lashT = 0; this.body?.setWhip?.('out'); this.whipOut = true; this.whipCoilAt = 0; if (this.actions.lash) this.oneShot('lash', LASH.windup + 0.6, 1, 0); }
  endLash() {
    if (this.lashT >= 0 && this.current === 'lash' && this.lashT < LASH.windup - 0.1) this.oneShotUntil = 0;   // cancelled: back to the base state
    this.lashT = -1;
  }
  // Own decoys are drawn see-through on the caster's screen.
  makeGhost() {
    this.model.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.transparent = true; o.material.opacity = 0.32; o.material.depthWrite = false;
      o.castShadow = false;
    });
    this.nameplate.material.opacity = 0.4;
  }

  // Game modes: the ring and nameplate switch to the team colour (or back to the wizard's own).
  setColor(color) {
    this.ring.material.color.setHex(color);
    const old = this.nameplate;
    const np = makeNameplate(this.bot ? `${this.name} · ${this.bot}` : this.name, color);
    np.position.copy(old.position); np.visible = old.visible; np.material.opacity = old.material.opacity;
    this.group.remove(old); old.material.map?.dispose(); old.material.dispose();
    this.group.add(np);
    this.nameplate = np;
  }

  // Round 13: the air jump (main.js calls it on our Space in the air and on a `jump` with n: 2): the tucked front
  // somersault (spellanim double_jump), then the float. The landing that ends this airtime plays the land kneel.
  airJump() {
    if (this.dead) return;
    this.flipped = true;
    // a front flip, or the backflip when the jump goes backwards (against the facing)
    const v = this.vel, yaw = this.group.rotation.y, sp = v ? Math.hypot(v.x, v.z) : 0;
    const back = sp > 0.5 && (v.x * Math.sin(yaw) + v.z * Math.cos(yaw)) / sp < -0.5;
    const key = back && this.actions.double_jump_back ? 'double_jump_back' : 'double_jump';
    if (this.actions[key]) this.oneShot(key, 0.45, 1, 0);
  }

  // Eye of the Storm's fling: the body is thrown up and lands (visual only; the server keeps feet on the ground).
  launch(h) { this.hopT = 0; this.hopH = h; }
  // Eye of the Storm: Gale turns as a tornado. Each call is one more spin of the clip (main.js repeats it).
  eyeSpin() {
    this.spinT = 0;
    if (this.actions.spin) this.oneShot('spin', CYC.spin * 1.4, this.actions.spin.getClip().duration / (CYC.spin * 1.4), 0);
    else this.oneShot('dash', CYC.spin, 2.5, 2.2);
  }

  startCyclone() { this.cycloneT = 0; }
  cancelCyclone() { this.cycloneT = -1; }
  // The pulse: two full turns over the spin, with the dash clip underneath.
  spin() {
    this.cycloneT = Math.max(this.cycloneT, CYC.windup);
    this.spinT = 0;
    // a body with its own sweep (Gale) plays the whole clip over the spin; others use the dash clip
    if (this.actions.spin) this.oneShot('spin', CYC.spin, this.actions.spin.getClip().duration / CYC.spin, 0);
    else this.oneShot('dash', CYC.spin, 2.5, 2.2);
  }

  // Decide the looping state from the mirrored server state + movement. Called every frame.
  // Ground velocity, measured from how the group actually moves (works for the local and remote wizards alike).
  measureVelocity(dt) {
    const p = this.group.position;
    this.vel ??= new THREE.Vector3(); this.prevPos ??= p.clone();
    if (dt > 0) {
      const vx = (p.x - this.prevPos.x) / dt, vz = (p.z - this.prevPos.z) / dt;
      if (Math.hypot(vx, vz) > 30) this.vel.set(0, 0, 0);   // a blink, a respawn: not walking
      else { const k = Math.min(1, dt * 10); this.vel.x += (vx - this.vel.x) * k; this.vel.z += (vz - this.vel.z) * k; }
    }
    this.prevPos.copy(p);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const fwd = speed > 0.01 ? (this.vel.x * Math.sin(this.group.rotation.y) + this.vel.z * Math.cos(this.group.rotation.y)) / speed : 1;
    // sideways when the motion is mostly across the facing (strafe clips); side > 0: to the body's left
    const side = speed > 0.01 ? (this.vel.x * Math.cos(this.group.rotation.y) - this.vel.z * Math.sin(this.group.rotation.y)) / speed : 0;
    return { speed, backward: fwd < -0.3, side: Math.abs(side) > 0.75 ? Math.sign(side) : 0 };
  }

  // The locomotion clip for this direction: the fight walk forward and sideways, the backward fight walk when
  // moving backward. Null when standing or in the air.
  locomotion(m, slow) {
    if (m.speed < 0.4 || (this.inAir ?? this.group.position.y > 0.3) || this.castRooted) return null;   // casting: the cast or idle pose, never a walk
    if (m.backward && this.actions.back) return 'back';
    if (this.sprinting && !slow && this.actions.run) return 'run';   // Sprint (Shift): the Running clip comes back for it
    if (m.side && !slow && this.actions.strafe_left) return m.side > 0 ? 'strafe_left' : 'strafe_right';
    return this.actions.walk_fight ? 'walk_fight' : 'run';
  }

  // Round 13: the push-off as a jump leaves the ground, and a landing when an airtime ends: the three-point crouch after
  // an air jump or a drop of 3 m or more, a light dip after a plain jump (nothing after stepping off a ledge). `jumping`
  // and `inAir` are mirrored for every wizard (main.js), so this needs no calls.
  updateJumpPoses(m) {
    const jumping = !!this.jumping && !this.dead, y = this.group.position.y;
    const air = !this.dead && (jumping || (this.inAir ?? y > 0.3));
    if (jumping && !this.wasJumping && !this.flipped && !this.hovering && !this.inOneShot() && this.actions.jump) this.oneShot('jump', 0.25, 1, 0);
    if (air) { this.airPeak = this.wasAir ? Math.max(this.airPeak, y) : y; this.airJumpSeen ||= jumping; }
    else if (this.wasAir && !this.dead) {
      const hard = this.flipped || this.airPeak - y >= 3, run = m.speed > 1.5;
      const [key, d] = hard ? ['land', run ? 0.22 : 0.4] : this.airJumpSeen ? ['land_soft', run ? 0.15 : 0.25] : [null, 0];
      if (key && this.actions[key] && (!this.inOneShot() || LANDABLE.test(this.current))) this.oneShot(key, d, (hard ? 0.4 : 0.3) / d, 0);
    }
    if (!air) { this.flipped = false; this.airJumpSeen = false; }
    this.wasJumping = jumping; this.wasAir = air;
  }

  updateAnimation(moving, dt) {
    const m = this.measureVelocity(dt);
    // back from the dead: a skeleton claws its way up, a mage drops in; a skeleton taunts over a kill
    if (this.wasDead && !this.dead) this.pose(this.actions.spawn ? 'spawn' : 'arrival');
    this.wasDead = this.dead;
    if (this.kills > (this.lastKills ?? this.kills) && this.actions.taunt && !this.dead && !this.inOneShot()) this.pose('taunt');
    this.lastKills = this.kills;
    // Skyward Flash descent: a body with a float clip (Rime) holds its airborne pose until it lands
    const floating = !this.dead && this.actions.float && (this.inAir ?? this.group.position.y > 0.3);
    if (floating) this.floatT = (this.floatT ?? 0) + dt; else this.floatT = 0;
    this.updateJumpPoses(m);
    if (this.dead) { this.setBase(this.actions.death ? 'death' : 'stun', 0.1); }
    else if (this.riding && !this.inOneShot()) this.setBase(this.actions.ride ? 'ride' : 'idle', 0.15);   // Jeb's Ram Ride: seated
    // a jump holds the float pose (round 13: after the jump's push-off or the air jump's flip, both one-shots); a hover
    // (a rooting wind-up started in the air) keeps the wind-up's pose instead
    else if (this.jumping && !this.hovering && !this.inOneShot() && this.actions.float) this.setBase('float', 0.12);
    // crouched: crouch clips when the characters agent adds them (crouch idle, crouch walk); the squash below stands in
    else if (this.crouch && !this.inOneShot() && (this.actions.crouch || this.actions.crouch_walk)) this.setBase(m.speed > 0.4 && this.actions.crouch_walk ? 'crouch_walk' : this.actions.crouch ? 'crouch' : 'crouch_walk', 0.15);
    else if (floating && !this.hovering && !this.inOneShot()) {
      const back = this.current !== 'float';
      this.setBase('float', 0.2);
      // returning to it after a cast mid-air: skip the fall straight to the held pose
      if (back && this.floatT > 1) this.actions.float.time = this.actions.float.getClip().duration;
    }
    else if (!this.inOneShot()) {
      const windup = this.charging || this.lashT >= 0 || (this.cycloneT >= 0 && this.cycloneT < CYC.windup);
      // moving slowly in a wind-up or behind a ward: the fight walk; standing: the cast or ward pose
      const loco = this.locomotion(m, windup || this.blocking || this.slowed);
      if (windup) this.setBase(loco || 'cast_heavy', 0.1);
      else if (this.blocking) this.setBase(loco || (this.guardStyle === 'black_death' && this.actions.shroud ? 'shroud' : 'block'));
      else if (loco) this.setBase(loco, 0.15);
      else this.setBase('idle', 0.25);
    }
    // time-scale the walk or run to the ground speed so the feet don't slide
    // the clip's own measured gait speed (looks.js: clip.userData.speed), else the table above
    const nat = NATURAL_SPEED[this.current] && (this.actions[this.current].getClip().userData?.speed || NATURAL_SPEED[this.current]);
    if (nat && !this.inOneShot()) this.actions[this.current].setEffectiveTimeScale(Math.min(6, Math.max(0.3, m.speed / nat)));
    this.updateSplit(m);
    this.mixer.update(dt);
    // no crouch clip yet: sink the body a little (scaled from the feet) while crouched
    if (this.model && !(this.actions.crouch || this.actions.crouch_walk)) {
      this.crouchBaseY ??= this.model.scale.y;
      this.crouchK = (this.crouchK ?? 0) + ((this.crouch && !this.dead ? 1 : 0) - (this.crouchK ?? 0)) * Math.min(1, dt * 12);
      this.model.scale.y = this.crouchBaseY * (1 - 0.3 * this.crouchK);
    }

    // ward bubble
    const w = this.blocking && !this.dead ? 1 : 0;
    const style = this.guardStyle, tNow = performance.now() / 1000;
    const wu = this.ward.material.uniforms;
    wu.opacity.value += (w - wu.opacity.value) * Math.min(1, dt * 14);
    wu.time.value = tNow * (style === 'black_death' ? 1.8 : 1);
    this.wardHitK = Math.max(0, (this.wardHitK || 0) - dt * 4);
    wu.hit.value = this.wardHitK;
    this.ward.visible = wu.opacity.value > 0.01;
    // the bubble swells in as it comes up
    const sw = 0.9 + 0.1 * wu.opacity.value;
    this.ward.scale.set(WARD.r * sw, WARD.h * sw, WARD.r * sw);
    if (this.wardFill) {
      const m = this.wardFill.material;
      m.opacity += (w * 0.97 - m.opacity) * Math.min(1, dt * 14);
      this.wardFill.visible = m.opacity > 0.01;
      const c = WARD.r * 0.98 + Math.sin(tNow * 9) * 0.03;
      this.wardFill.scale.set(c, WARD.h * 0.98 + Math.cos(tNow * 7) * 0.04, c);
    }
    // Vesper's whip: out in her hand through the Lash, coiled at her hip again half a second after
    if (this.whipOut && this.lashT < 0) {
      this.whipCoilAt ||= tNow + 0.5;
      if (tNow >= this.whipCoilAt) { this.body.setWhip?.('coiled'); this.whipOut = false; this.whipCoilAt = 0; }
    }

    // charge orb follows the staff hand
    // the staff hand glows through a heavy wind-up, and gold through an ultimate's wind-up
    const glowing = (this.charging || this.ultWinding) && !this.dead;
    if (glowing) {
      const gold = this.ultWinding && !this.charging;
      this.chargeOrb.material.color.setHex(gold ? 0xffd860 : 0xff8a3c); this.chargeLight.color.setHex(gold ? 0xffc040 : 0xff7a2a);
      this.chargeT += dt;
      const hp = new THREE.Vector3(); this.tip.getWorldPosition(hp);
      this.chargeOrb.visible = true;
      this.chargeOrb.position.copy(hp);
      const s = 0.4 + Math.min(1.3, this.chargeT) * 1.2 + Math.sin(this.chargeT * 30) * 0.08;
      this.chargeOrb.scale.setScalar(s);
      this.chargeOrb.rotation.y += dt * 8;
      this.chargeLight.position.copy(hp);
      this.chargeLight.intensity = 2 + this.chargeT * 6;
    } else {
      this.chargeT = 0; this.chargeOrb.visible = false; this.chargeLight.intensity = 0;
    }

    this.updateCyclone(dt);
    this.updateShadow();
    this.updateBinds(dt);

    // health bar
    this.hpFill.scale.x = Math.max(0.001, this.hp / 100);
    this.hpFill.position.x = -(1 - this.hp / 100) * 0.6;
    this.ring.material.opacity = this.dead ? 0.1 : 0.75;

    this.updateCarry(dt);

    // death: sink into the ground
    const target = this.dead && !this.actions.death ? 1 : 0;   // a body with a death clip falls instead of sinking
    this.dissolve += (target - this.dissolve) * Math.min(1, dt * (this.dead ? 1.2 : 8));
    let hop = 0;
    if (this.hopT >= 0 && this.hopT !== undefined) {
      this.hopT += dt;
      const k = this.hopT / 0.8;
      if (k >= 1 || this.dead) this.hopT = -1; else hop = 4 * k * (1 - k) * this.hopH;
    }
    // on a ram (Ram Ride): he sits up on its back while mounted
    this.rideLift = (this.rideLift ?? 0) + ((this.riding && !this.dead ? C.SPELLBOOK.ram_ride.height : 0) - (this.rideLift ?? 0)) * Math.min(1, dt * 10);
    // hanging in the air through a rooting wind-up (main.js sets `hovering`): a slow float bob
    this.hoverK = (this.hoverK ?? 0) + ((this.hovering && !this.dead ? 1 : 0) - (this.hoverK ?? 0)) * Math.min(1, dt * 6);
    const bob = this.hoverK > 0.001 ? this.hoverK * (0.06 + Math.sin(performance.now() / 1000 * 5.2) * 0.06) : 0;
    // round 15: the procedural flip (spellanim FLIPS: the air jump, air rolls, Smoke Screen) turns the body once about its middle;
    // Meteor Rain's dive pitches it head-first
    // A ground roll (spellanim FLIPS with `axis` 'z' for a sideways roll, `pivot` and `squash`) shrinks the body mid-turn so the
    // tumble stays a tight ball on the ground.
    let flip = 0, roll = 0, squash = 1, mid = 0.85;
    if (this.flip) {
      const f = this.flip;
      f.t += dt;
      const k = Math.min(1, f.t / f.time), a = f.dir * Math.PI * 2 * (k * k * (3 - 2 * k));
      if (f.axis === 'z') roll = a; else flip = a;
      mid = f.pivot ?? mid;
      squash = 1 - (f.squash || 0) * Math.sin(Math.PI * k);
      if (k >= 1 || this.dead) this.flip = null;
    }
    this.diveK = (this.diveK ?? 0) + ((this.current === 'mrain_dive' && !this.dead ? 1 : 0) - (this.diveK ?? 0)) * Math.min(1, dt * 10);
    // the turn's centre, `mid` up the (squashed) body, stays put
    const pitch = flip + this.diveK * 1.45, c = mid * squash;
    this.model.scale.setScalar(squash);
    this.model.position.y = -this.dissolve * 1.6 + hop + this.rideLift + bob + c - c * Math.cos(pitch) * Math.cos(roll);
    this.model.position.z = -c * Math.sin(pitch);
    this.model.position.x = c * Math.sin(roll) * Math.cos(pitch);
    this.model.rotation.x = this.dissolve * 0.5 + pitch;
    this.model.rotation.z = roll;
  }

  updateCyclone(dt) {
    if (this.dead) { this.cycloneT = -1; this.spinT = -1; }
    // spin the model (the group keeps facing the aim)
    if (this.spinT >= 0) {
      this.spinT += dt;
      const k = Math.min(1, this.spinT / CYC.spin);
      this.model.rotation.y = (1 - Math.pow(1 - k, 2)) * Math.PI * 4;
      if (k >= 1) { this.spinT = -1; this.model.rotation.y = 0; }
    }
    if (this.cycloneT < 0) { this.rune.visible = false; return; }
    this.cycloneT += dt;
    const fadeOut = CYC.windup + 0.25;
    if (this.cycloneT > fadeOut) { this.cycloneT = -1; this.rune.visible = false; return; }
    // grows to the full radius over the wind-up, then flares and fades as the spin goes off
    const k = Math.min(1, this.cycloneT / CYC.windup);
    const grow = 1 - Math.pow(1 - k, 3);
    this.rune.visible = true;
    this.rune.position.set(this.group.position.x, 0.13, this.group.position.z);   // above the courtyard decals (0.05)
    this.rune.scale.setScalar(Math.max(0.05, grow * CYC.radius));
    this.rune.rotation.y += dt * (1.2 + k * 3);
    this.rune.material.opacity = this.cycloneT <= CYC.windup ? 0.35 + 0.55 * k + Math.sin(this.cycloneT * 40) * 0.05
      : 0.9 * (1 - (this.cycloneT - CYC.windup) / (fadeOut - CYC.windup));
  }

  // Lash coil (tightening and brightening over the wind-up), chains when bound, frost when slowed.
  updateBinds(dt) {
    const now = performance.now() / 1000;
    if (this.dead) this.lashT = -1;
    if (this.lashT >= 0) {
      this.lashT += dt;
      const k = Math.min(1, this.lashT / LASH.windup);
      this.coil.visible = true;
      this.coil.rotation.y += dt * (2 + k * 9);
      const s = 1.35 - k * 0.4 + Math.sin(this.lashT * 25) * 0.03 * k;
      this.coil.scale.set(s, 0.6 + k * 0.4, s);
      this.coil.material.opacity = 0.35 + 0.6 * k;
      if (this.lashT > LASH.windup + 0.6) this.lashT = -1;   // missed the release message
    } else this.coil.visible = false;
    this.chains.visible = this.bound && !this.frozen && !this.dead;
    this.veil.visible = this.veiled && !this.dead;
    if (this.veil.visible) {
      for (const st of this.veilStreaks) st.arc.rotation.z += dt * st.speed;
      this.veil.rotation.y += dt * 1.2;
      this.veilFlashT = Math.max(0, this.veilFlashT - dt);
      this.veilShell.material.opacity = 0.14 + this.veilFlashT * 1.6;
      this.veil.scale.setScalar(1 + this.veilFlashT * 0.4 + Math.sin(now * 9) * 0.015);
    }
    this.ice.visible = this.frozen && !this.dead;
    if (this.chains.visible) {
      this.chains.children.forEach((c, i) => { if (i < 3) c.rotation.z += dt * (i % 2 ? -2.2 : 2.6); });
      this.chains.children[3].rotation.y += dt * 1.5;
      this.chains.scale.setScalar(1 + Math.sin(now * 14) * 0.03);
    }
    this.frost.visible = this.slowed && !this.dead;
    if (this.frost.visible) this.frost.rotation.y += dt * 0.6;
  }

  updateShadow() {
    const y = this.group.position.y;
    const show = y > 0.3 && !this.dead;
    this.shadow.visible = show;
    if (!show) return;
    this.shadow.position.set(this.group.position.x, 0.12, this.group.position.z);
    this.shadow.scale.setScalar(0.8 + y * 0.08);
    this.shadow.material.opacity = 0.9 - y * 0.05;
  }

  // Smooth remote movement toward the latest snapshot.
  interpolate(dt) {
    const k = Math.min(1, dt * 14);
    this.group.position.lerp(this.targetPos, k);
    let d = this.targetYaw - this.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.group.rotation.y += d * k;
  }

  faceCamera(camera) {
    this.nameplate.quaternion.copy(camera.quaternion);
    this.hpBar.quaternion.copy(camera.quaternion);
  }

  // A spell broke on our ward: the bubble flares for a moment (main.js calls it next to effects.blockFlash).
  wardHit() { this.wardHitK = 1; }

  // Start (or stop, with null) holding a prop by telekinesis. `liftFrom` is where it rises from.
  setCarry(mesh, liftFrom = null) {
    if (this.carry) { this.scene.remove(this.carry.holder); this.carry = null; }
    this.carryMesh = mesh;
    this.beam.visible = false;
    if (!mesh) return;
    const type = mesh.userData.type;
    const spec = C.PROP_TYPES[type];
    const holder = new THREE.Group();
    mesh.position.y = -spec.h * 0.5;             // pivot at the prop's middle
    const shell = new THREE.Mesh(bubbleGeo, shellMat);
    shell.scale.setScalar(spec.r + 0.25);
    holder.add(mesh, shell);
    const start = liftFrom ? new THREE.Vector3(liftFrom[0], spec.h * 0.5, liftFrom[2]) : this.holdPoint();
    holder.position.copy(start);
    this.scene.add(holder);
    this.carry = { holder, shell, start, t: liftFrom ? 0 : 1, spin: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize() };
  }

  holdPoint() {
    const p = this.group.position;
    const hp = C.holdPoint([p.x, p.y, p.z], this.group.rotation.y);
    return new THREE.Vector3(hp[0], hp[1], hp[2]);
  }

  updateCarry(dt) {
    const c = this.carry;
    if (!c && this.beamTo && !this.dead) { this.drawBeam(this.beamTo); return; }   // a held goat
    if (!c || this.dead) { this.beam.visible = false; if (c) c.holder.visible = !this.dead; return; }
    const now = performance.now() / 1000;
    c.t = Math.min(1, c.t + dt / C.TK.liftTime);
    const e = 1 - Math.pow(1 - c.t, 3);                         // ease-out
    const hold = this.holdPoint();
    hold.y += Math.sin(now * 2.6 + this.id) * 0.07;              // gentle bob
    if (c.t < 1) {
      // rise in an arc from where it stood
      c.holder.position.lerpVectors(c.start, hold, e);
      c.holder.position.y += Math.sin(e * Math.PI) * 0.6;
    } else c.holder.position.lerp(hold, Math.min(1, dt * 16));
    c.holder.rotateOnAxis(c.spin, dt * (c.t < 1 ? 6 : 0.9));
    c.shell.rotation.y += dt * 2; c.shell.rotation.x += dt * 1.3;
    c.shell.material.uniforms.opacity.value = 0.8 + Math.sin(now * 6) * 0.2;
    c.shell.material.uniforms.time.value = now;

    this.drawBeam(c.holder.position);
  }

  // Telekinesis beam: motes along a curve from the staff hand to `to`, drifting outward.
  drawBeam(to) {
    const now = performance.now() / 1000;
    const hand = new THREE.Vector3(); this.tip.getWorldPosition(hand);
    const mid = hand.clone().lerp(to, 0.5); mid.y += 0.35;
    this.beam.visible = true;
    this.beam.children.forEach((m, i) => {
      const k = ((i / BEAM_MOTES) + now * 1.4) % 1;
      const a = 1 - k;
      m.position.set(
        a * a * hand.x + 2 * a * k * mid.x + k * k * to.x,
        a * a * hand.y + 2 * a * k * mid.y + k * k * to.y,
        a * a * hand.z + 2 * a * k * mid.z + k * k * to.z);
      m.position.x += Math.sin(now * 9 + i * 1.7) * 0.05;
      m.position.y += Math.cos(now * 8 + i * 2.3) * 0.05;
      m.scale.setScalar(0.035 + Math.sin(k * Math.PI) * 0.045);
    });
  }

  dispose(scene) {
    this.setCarry(null);
    scene.remove(this.beam);
    scene.remove(this.group);
    scene.remove(this.chargeOrb);
    scene.remove(this.chargeLight);
    scene.remove(this.rune);
    scene.remove(this.shadow);
  }
}
