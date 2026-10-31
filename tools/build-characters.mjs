#!/usr/bin/env node
// Round 15: build the KayKit character models and the clip file from Ty's packs (CC0, Kay Lousberg).
//   node tools/build-characters.mjs [packs-dir]        (default ~/Downloads)
// Writes public/models/characters/:
//   mage.glb, skeleton_{mage,warrior,rogue,minion}.glb   one joined skinned mesh per material, the weapon baked under
//                                                         the right hand slot with a 'tip' node at its far end, webp atlas
//   clips.glb                                            the Rig_Medium clips looks.js / spellanim.js use, skeleton only
// Everything is meshopt-compressed (three needs MeshoptDecoder on the loader). Node names lose their dots ('handslot.r' ->
// 'handslot_r'): three strips dots from node names, so this keeps the names we type and the names three sees the same.
// Needs @gltf-transform 4, meshoptimizer and sharp: installed once into $WA_DEPS (default: a folder in the system temp dir).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPS = process.env.WA_DEPS || path.join(tmpdir(), 'wa-gltf-deps');
if (!existsSync(path.join(DEPS, 'node_modules/@gltf-transform/functions'))) {
  mkdirSync(DEPS, { recursive: true });
  execSync('npm i --silent @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer sharp', { cwd: DEPS, stdio: 'inherit' });
}
const req = createRequire(path.join(DEPS, 'x.js'));
const { NodeIO, Document } = req('@gltf-transform/core');
const { ALL_EXTENSIONS } = req('@gltf-transform/extensions');
const { prune, dedup, resample, meshopt, textureCompress, mergeDocuments, weld } = req('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = req('meshoptimizer');
const sharp = req('sharp');

const PACKS = process.argv[2] || path.join(homedir(), 'Downloads');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'public/models/characters');
mkdirSync(OUT, { recursive: true });
const ADV = path.join(PACKS, 'KayKit_Adventurers_2.0_FREE');
const SKEL = path.join(PACKS, 'KayKit_Skeletons_1.1_FREE');
const ANIM = path.join(PACKS, 'KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium');

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// body -> source, weapons ([gltf, slot]), and the atlas size (the KayKit atlases are flat colour swatches: 512 is plenty)
const BODIES = {
  mage: { src: `${ADV}/Characters/gltf/Mage.glb`, weapons: [[`${ADV}/Assets/gltf/staff.gltf`, 'handslot_r', 'tip']] },
  skeleton_mage: { src: `${SKEL}/characters/gltf/Skeleton_Mage.glb`, weapons: [[`${SKEL}/assets/gltf/Skeleton_Staff.gltf`, 'handslot_r', 'tip']] },
  skeleton_warrior: { src: `${SKEL}/characters/gltf/Skeleton_Warrior.glb`, weapons: [[`${SKEL}/assets/gltf/Skeleton_Axe.gltf`, 'handslot_r', 'tip'], [`${SKEL}/assets/gltf/Skeleton_Shield_Large_A.gltf`, 'handslot_l']] },
  skeleton_rogue: { src: `${SKEL}/characters/gltf/Skeleton_Rogue.glb`, weapons: [[`${SKEL}/assets/gltf/Skeleton_Crossbow.gltf`, 'handslot_r', 'tip']] },
  skeleton_minion: { src: `${SKEL}/characters/gltf/Skeleton_Minion.glb`, weapons: [[`${SKEL}/assets/gltf/Skeleton_Blade.gltf`, 'handslot_r', 'tip']] },
};
const ATLAS = 512;

const undot = (doc) => { for (const n of doc.getRoot().listNodes()) n.setName(n.getName().replace(/\./g, '_')); };

// Join every skinned mesh's primitives that share a material into one primitive on one node (one draw call per material).
function joinSkinned(doc) {
  const root = doc.getRoot();
  const nodes = root.listNodes().filter(n => n.getMesh() && n.getSkin());
  if (nodes.length < 2) return;
  const skin = nodes[0].getSkin();
  const byMat = new Map();
  for (const n of nodes) for (const p of n.getMesh().listPrimitives()) {
    if (n.getSkin() !== skin) throw new Error('two skins');
    const m = p.getMaterial();
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m).push(p);
  }
  const mesh = doc.createMesh('Body');
  const buf = root.listBuffers()[0];
  for (const [mat, prims] of byMat) {
    const sems = prims[0].listSemantics();
    const out = doc.createPrimitive().setMaterial(mat);
    let base = 0;
    const idx = [];
    const arrays = Object.fromEntries(sems.map(s => [s, []]));
    for (const p of prims) {
      const n = p.getAttribute('POSITION').getCount();
      for (const s of sems) {
        const a = p.getAttribute(s);
        if (!a) throw new Error(`primitive without ${s}`);
        arrays[s].push(a);
      }
      const ind = p.getIndices();
      for (let i = 0; i < ind.getCount(); i++) idx.push(ind.getScalar(i) + base);
      base += n;
    }
    for (const s of sems) {
      const first = arrays[s][0], size = first.getElementSize();
      const Arr = first.getArray().constructor;
      const all = new Arr(base * size);
      let o = 0;
      for (const a of arrays[s]) { all.set(a.getArray(), o); o += a.getArray().length; }
      out.setAttribute(s, doc.createAccessor(s).setType(first.getType()).setArray(all).setNormalized(first.getNormalized()).setBuffer(buf));
    }
    out.setIndices(doc.createAccessor('indices').setType('SCALAR').setArray(base > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)).setBuffer(buf));
    mesh.addPrimitive(out);
  }
  const host = doc.createNode('Body').setMesh(mesh).setSkin(skin);
  const parent = nodes[0].getParentNode();
  if (parent) parent.addChild(host); else root.listScenes()[0].addChild(host);
  for (const n of nodes) { n.getMesh().dispose(); n.dispose(); }
}

// The far end of a weapon (its longest axis, the positive end), a little inside the mesh: where spells leave it.
function weaponTip(doc, node) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of node.getMesh().listPrimitives()) {
    const a = p.getAttribute('POSITION'), lo = a.getMin([]), hi = a.getMax([]);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], lo[i]); max[i] = Math.max(max[i], hi[i]); }
  }
  const ext = max.map((v, i) => v - min[i]), ax = ext.indexOf(Math.max(...ext));
  const t = min.map((v, i) => (v + max[i]) / 2);
  t[ax] = max[ax] - ext[ax] * 0.07;
  return t;
}

async function buildBody(id, cfg) {
  const doc = await io.read(cfg.src);
  undot(doc);
  joinSkinned(doc);
  for (const [src, slot, tipName] of cfg.weapons) {
    const w = await io.read(src);
    const wNodes = w.getRoot().listScenes()[0].listChildren().map(n => n.getName());
    mergeDocuments(doc, w);
    const root = doc.getRoot();
    const hand = root.listNodes().find(n => n.getName() === slot);
    // mergeDocuments adds the weapon's scene; move its top nodes under the hand slot (KayKit props are modelled for it)
    const scenes = root.listScenes();
    const wScene = scenes[scenes.length - 1];
    for (const n of wScene.listChildren()) {
      if (!wNodes.includes(n.getName())) continue;
      wScene.removeChild(n); hand.addChild(n);
      if (tipName && n.getMesh()) hand.addChild(doc.createNode(tipName).setTranslation(weaponTip(doc, n)));
    }
    wScene.dispose();
    for (const b of root.listBuffers().slice(1)) { for (const a of root.listAccessors()) if (a.getBuffer() === b) a.setBuffer(root.listBuffers()[0]); b.dispose(); }
  }
  if (!doc.getRoot().listNodes().some(n => n.getName() === 'tip')) {   // no weapon: the hand slot itself
    doc.getRoot().listNodes().find(n => n.getName() === 'handslot_r').addChild(doc.createNode('tip'));
  }
  // weapons reference the same atlas png as the body: dedup merges the images, then one webp
  await doc.transform(
    dedup(), weld(), prune({ keepLeaves: true }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [ATLAS, ATLAS], quality: 90 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const file = path.join(OUT, `${id}.glb`);
  await io.write(file, doc);
  return file;
}

// ---------------------------------------------------------------- clips
const CLIPS = {
  General: ['Death_A', 'Death_B', 'Hit_A', 'Hit_B', 'Idle_A', 'Idle_B', 'Interact', 'PickUp', 'Spawn_Air', 'Spawn_Ground', 'Throw', 'Use_Item'],
  MovementBasic: ['Jump_Full_Long', 'Jump_Full_Short', 'Jump_Idle', 'Jump_Land', 'Jump_Start', 'Running_A', 'Running_B', 'Walking_A', 'Walking_B', 'Walking_C'],
  MovementAdvanced: ['Crouching', 'Dodge_Backward', 'Dodge_Forward', 'Dodge_Left', 'Dodge_Right', 'Running_Strafe_Left', 'Running_Strafe_Right', 'Sneaking', 'Walking_Backwards'],
  CombatRanged: ['Ranged_Magic_Raise', 'Ranged_Magic_Shoot', 'Ranged_Magic_Spellcasting', 'Ranged_Magic_Spellcasting_Long', 'Ranged_Magic_Summon', 'Ranged_1H_Shoot'],
  CombatMelee: ['Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Slice_Horizontal', 'Melee_1H_Attack_Stab', 'Melee_1H_Attack_Jump_Chop',
    'Melee_2H_Attack_Chop', 'Melee_2H_Attack_Slice', 'Melee_2H_Attack_Spin', 'Melee_2H_Attack_Spinning', 'Melee_Block', 'Melee_Block_Attack', 'Melee_Block_Hit', 'Melee_Blocking',
    'Melee_Unarmed_Attack_Kick', 'Melee_Unarmed_Attack_Punch_A'],
  Special: ['Skeletons_Awaken_Floor', 'Skeletons_Awaken_Standing', 'Skeletons_Death', 'Skeletons_Death_Resurrect', 'Skeletons_Idle', 'Skeletons_Taunt', 'Skeletons_Spawn_Ground'],
  Simulation: ['Lie_Down', 'Lie_StandUp', 'Cheering'],
};

async function buildClips() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('clips');
  let nodes = null;           // name -> node (the rig, from the first file)
  const restT = new Map();
  for (const [file, names] of Object.entries(CLIPS)) {
    const src = await io.read(`${ANIM}/Rig_Medium_${file}.glb`);
    undot(src);
    if (!nodes) {
      // copy the bone hierarchy (no meshes, no skin)
      nodes = new Map();
      const copy = (n, parent) => {
        const c = doc.createNode(n.getName()).setTranslation(n.getTranslation()).setRotation(n.getRotation()).setScale(n.getScale());
        nodes.set(n.getName(), c); restT.set(n.getName(), n.getTranslation());
        if (parent) parent.addChild(c); else scene.addChild(c);
        for (const k of n.listChildren()) if (!k.getMesh()) copy(k, c);
      };
      for (const n of src.getRoot().listScenes()[0].listChildren()) if (!n.getMesh()) copy(n, null);
    }
    for (const a of src.getRoot().listAnimations()) {
      if (!names.includes(a.getName())) continue;
      const out = doc.createAnimation(a.getName());
      for (const ch of a.listChannels()) {
        const node = ch.getTargetNode(), pathName = ch.getTargetPath(), s = ch.getSampler();
        const vals = s.getOutput().getArray(), size = s.getOutput().getElementSize();
        const constant = vals.every((v, i) => Math.abs(v - vals[i % size]) < 1e-5);
        // drop tracks that never move from the rest pose: scale 1, translations at rest (every bone but the hips)
        if (pathName === 'scale' && constant && [0, 1, 2].every(i => Math.abs(vals[i] - 1) < 1e-4)) continue;
        if (pathName === 'translation' && constant && restT.get(node.getName()).every((v, i) => Math.abs(v - vals[i]) < 1e-4)) continue;
        const target = nodes.get(node.getName());
        if (!target) continue;
        const input = doc.createAccessor().setType('SCALAR').setArray(s.getInput().getArray().slice()).setBuffer(buf);
        const output = doc.createAccessor().setType(s.getOutput().getType()).setArray(vals.slice()).setBuffer(buf);
        const smp = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
        out.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(pathName).setSampler(smp));
      }
    }
  }
  const got = doc.getRoot().listAnimations().map(a => a.getName());
  const want = Object.values(CLIPS).flat().filter(n => !got.includes(n));
  if (want.length) console.warn('missing clips:', want.join(', '));
  await doc.transform(resample({ tolerance: 1e-4 }), dedup(), prune({ keepLeaves: true }));
  // rotations as normalized int16 (core glTF allows it for rotation outputs; three's loader rescales them): half the bytes
  for (const a of doc.getRoot().listAnimations()) for (const ch of a.listChannels()) {
    if (ch.getTargetPath() !== 'rotation') continue;
    const out = ch.getSampler().getOutput(), v = out.getArray();
    if (!(v instanceof Float32Array)) continue;
    out.setArray(Int16Array.from(v, x => Math.round(Math.max(-1, Math.min(1, x)) * 32767))).setNormalized(true);
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = path.join(OUT, 'clips.glb');
  await io.write(file, doc);
  console.log(`clips: ${got.length}`);
  return file;
}

const only = process.env.ONLY?.split(',');
for (const [id, cfg] of Object.entries(BODIES)) if (!only || only.includes(id)) console.log('wrote', await buildBody(id, cfg));
if (!only || only.includes('clips')) console.log('wrote', await buildClips());
