// npm run build:crazygames: the client as static files for CrazyGames (deploy-owned).
//   node tools/build-crazygames.mjs [--server wss://host] [--out dist/crazygames] [--ref <commit>] [--no-zip] [--allow-abs]
//   --ref builds from a commit's public/ (git archive) instead of the working tree: use it for the upload, so
//   nobody's uncommitted work ships. Without it, uncommitted changes under public/ are listed as a warning.
// Writes <out>/ and <out>.zip (index.html at the zip's root):
//   - public/ minus the map editor (edit.html, js/editor*.js) and OS junk; fails on unconverted source formats (.gltf, .fbx...)
//   - every URL relative: CrazyGames serves the game from a subpath, so a root path ('/models/x') misses. The build
//     FAILS on any root-absolute path in the sources and lists each file:line, so it's fixed in the source.
//     --allow-abs rewrites them in the copy instead ('/models/x' -> './models/x') with a warning: for a test build
//     while an owner's fix is pending, never for the upload
//   - three.js vendored: only the files the client imports (followed through the addons' own imports)
//   - config.js setting window.WA_SERVER (default wss://wizard-arena-76od.onrender.com), read by net.js
//   - the CrazyGames SDK v3 and deploy/crazygames/platform.js (guarded gameplayStart / gameplayStop)
// Then it checks CrazyGames' limits (file count, sizes) and prints a summary.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const SERVER = arg('--server', 'wss://wizard-arena-76od.onrender.com');
const OUT = path.resolve(ROOT, arg('--out', 'dist/crazygames'));
const ZIP = !process.argv.includes('--no-zip');
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const REF = arg('--ref', null);
const ALLOW_ABS = process.argv.includes('--allow-abs');
const THREE = path.join(ROOT, 'node_modules', 'three');

// CrazyGames' published limits (developer docs, "Technical requirements"); re-check them before submitting
const LIMITS = { files: 1500, totalMB: 250, initialMB: 50 };
// the map editor's page and scripts (editor.js, and any editor-*.js it grows) never ship
const EDITOR = /^edit\.html$|^js\/editor([-_.][\w-]+)?\.js$|^css\/edit(or)?\.css$/;
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|\.gitkeep)$|\.(orig|bak|tmp)$/;
const TEXT = /\.(html|js|mjs|css|json)$/;
// source formats that must be converted (GLB with meshopt, webp) before they go in public/
const RAW = /\.(gltf|fbx|obj|mtl|blend|blend1|dae|3ds|max|psd|tga|exr|hdr)$/i;
// a quote, backtick or "(" then a root-absolute path into one of the client's folders
const ABS = /(["'`(])\/(?=(vendor|models|textures|sounds|css|js|shared|icons|favicon)\b)/g;

const warnings = [];

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

// ---- 1. copy public/
fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(OUT + '.zip', { force: true });
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
let PUBLIC = path.join(ROOT, 'public'), tmp = null;
if (REF) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-build-'));
  execFileSync('sh', ['-c', `git archive ${JSON.stringify(REF)} public | tar -x -C ${JSON.stringify(tmp)}`], { cwd: ROOT });
  PUBLIC = path.join(tmp, 'public');
} else {
  const dirty = git('status', '--porcelain', '--', 'public').split('\n').filter(Boolean);
  if (dirty.length) warnings.push(`built from the working tree with ${dirty.length} uncommitted change(s) under public/ (use --ref HEAD for the upload)`);
}
const tracked = new Set(git('ls-files', 'public').split('\n').filter(Boolean).map(f => f.slice('public/'.length)));
for (const f of walk(PUBLIC)) {
  if (EDITOR.test(f) || JUNK.test(f)) continue;
  if (!tracked.has(f)) warnings.push(`untracked file shipped: public/${f}`);
  fs.mkdirSync(path.join(OUT, path.dirname(f)), { recursive: true });
  fs.copyFileSync(path.join(PUBLIC, f), path.join(OUT, f));
}
if (tmp) fs.rmSync(tmp, { recursive: true, force: true });

// ---- 2. relative URLs, and no unconverted source formats
const raw = walk(OUT).filter(f => RAW.test(f));
if (raw.length) {
  console.error('source-format files in public/ (convert to GLB/webp with tools/optimize-models.sh, or remove):\n  ' + raw.join('\n  '));
  process.exit(1);
}
const absAt = [];
for (const f of walk(OUT).filter(f => TEXT.test(f))) {
  const p = path.join(OUT, f), src = fs.readFileSync(p, 'utf8');
  const hits = [...src.matchAll(ABS)];
  if (!hits.length) continue;
  for (const m of hits) {
    const line = src.slice(0, m.index).split('\n').length;
    absAt.push(`${f}:${line}: ${src.slice(m.index, src.indexOf('\n', m.index)).trim().slice(0, 60)}`);
  }
  if (ALLOW_ABS) {
    fs.writeFileSync(p, src.replace(ABS, '$1./'));
    warnings.push(`--allow-abs: rewrote ${hits.length} absolute path(s) in ${f} (not for the upload: fix the source)`);
  }
}
if (absAt.length && !ALLOW_ABS) {
  console.error(`root-absolute paths in the sources (CrazyGames serves from a subpath, so these 404). Make them relative ('./models/...'),\n` +
    `or pass --allow-abs for a test build:\n  ` + absAt.join('\n  '));
  process.exit(1);
}

// ---- 3. the server URL: config.js, and net.js must read it
fs.writeFileSync(path.join(OUT, 'config.js'),
  `// Written by tools/build-crazygames.mjs: the game server this build connects to (net.js reads it).\nwindow.WA_SERVER = ${JSON.stringify(SERVER)};\n`);
const netFile = path.join(OUT, 'js', 'net.js');
let net = fs.readFileSync(netFile, 'utf8');
if (!net.includes('WA_SERVER')) {
  const plain = 'new WebSocket(`${proto}://${location.host}`)';
  if (!net.includes(plain)) throw new Error('net.js reads no WA_SERVER and its WebSocket line changed: cannot point the build at the server');
  net = net.replace(plain, 'new WebSocket(window.WA_SERVER || `${proto}://${location.host}`)');
  fs.writeFileSync(netFile, net);
  warnings.push('net.js: patched the WebSocket URL to read window.WA_SERVER (spells: see requests.md)');
}

// ---- 4. index.html: config, SDK, platform shim
fs.copyFileSync(path.join(ROOT, 'deploy', 'crazygames', 'platform.js'), path.join(OUT, 'platform.js'));
const indexFile = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
const head = `<script src="./config.js"></script>\n<script src="${SDK_URL}"></script>\n<script src="./platform.js"></script>\n`;
if (!html.includes('<script type="importmap">')) throw new Error('index.html has no importmap');
html = html.replace('<script type="importmap">', head + '<script type="importmap">');
if (!/rel="icon"/.test(html) && fs.existsSync(path.join(OUT, 'favicon.png')))
  html = html.replace('</title>', '</title>\n<link rel="icon" href="./favicon.ico" sizes="any">\n<link rel="icon" type="image/png" href="./favicon.png">');
fs.writeFileSync(indexFile, html);

// ---- 5. vendored three: follow the client's imports
const importsOf = (src) => [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g)].map(m => m[2]);
const need = new Set();   // paths under node_modules/three
const queue = [];
const want = (p) => { if (!need.has(p)) { need.add(p); queue.push(p); } };
for (const f of walk(OUT).filter(f => /\.m?js$/.test(f))) {
  for (const spec of importsOf(fs.readFileSync(path.join(OUT, f), 'utf8'))) {
    if (spec === 'three') want('build/three.module.js');
    else if (spec.startsWith('three/addons/')) want('examples/jsm/' + spec.slice('three/addons/'.length));
  }
}
while (queue.length) {
  const p = queue.shift();
  if (!fs.existsSync(path.join(THREE, p))) throw new Error(`three file not found: ${p}`);
  for (const spec of importsOf(fs.readFileSync(path.join(THREE, p), 'utf8'))) {
    if (spec === 'three') want('build/three.module.js');
    else if (spec.startsWith('.')) want(path.posix.normalize(path.posix.join(path.posix.dirname(p), spec)));
  }
}
for (const p of need) {
  const to = path.join(OUT, 'vendor', 'three', p);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // the minified core is the same module, half the bytes
  const from = p === 'build/three.module.js' && fs.existsSync(path.join(THREE, 'build/three.module.min.js')) ? 'build/three.module.min.js' : p;
  fs.copyFileSync(path.join(THREE, from), to);
}
fs.copyFileSync(path.join(THREE, 'LICENSE'), path.join(OUT, 'vendor', 'three', 'LICENSE'));

// ---- 6. checks
const files = walk(OUT);
const left = [];
for (const f of files.filter(f => TEXT.test(f))) {
  const src = fs.readFileSync(path.join(OUT, f), 'utf8');
  for (const m of src.matchAll(ABS)) left.push(`${f}: ...${src.slice(m.index, m.index + 40)}`);
}
for (const f of files.filter(f => EDITOR.test(f))) left.push(`map editor file in the build: ${f}`);
if (left.length) { console.error('absolute paths left in the build:\n  ' + left.join('\n  ')); process.exit(1); }

const size = (f) => fs.statSync(path.join(OUT, f)).size;
const total = files.reduce((s, f) => s + size(f), 0);
const MB = (b) => (b / 1048576).toFixed(1) + ' MB';
const biggest = files.map(f => [f, size(f)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
let zipBytes = 0;
if (ZIP) {
  execFileSync('zip', ['-qr9X', OUT + '.zip', '.'], { cwd: OUT });
  zipBytes = fs.statSync(OUT + '.zip').size;
}

console.log(`build: ${path.relative(ROOT, OUT)}/ from ${REF ? `commit ${git('rev-parse', '--short', REF).trim()}` : 'the working tree'}`);
console.log(`server: ${SERVER}`);
console.log(`files: ${files.length} (limit ${LIMITS.files})`);
console.log(`size: ${MB(total)} unzipped${ZIP ? `, ${MB(zipBytes)} zip (${path.relative(ROOT, OUT)}.zip)` : ''} (limit ${LIMITS.totalMB} MB)`);
console.log(`three: ${need.size} files vendored`);
console.log('largest: ' + biggest.map(([f, b]) => `${f} ${MB(b)}`).join(', '));
// by folder (models/ split one level deeper: castle, village, characters...), to track the download budget
const byDir = new Map();
for (const f of files) {
  const parts = f.split('/');
  const k = parts.length === 1 ? '(root)' : parts[0] === 'models' && parts.length > 2 ? parts.slice(0, 2).join('/') + '/' : parts[0] + '/';
  const e = byDir.get(k) || { n: 0, b: 0 }; e.n++; e.b += size(f); byDir.set(k, e);
}
console.log('by folder: ' + [...byDir].sort((a, b) => b[1].b - a[1].b).map(([k, e]) => `${k} ${MB(e.b)} (${e.n})`).join(', '));
for (const w of warnings) console.log('warning: ' + w);
const over = files.length > LIMITS.files || total > LIMITS.totalMB * 1048576;
if (over) { console.error('OVER CrazyGames limits'); process.exit(1); }
