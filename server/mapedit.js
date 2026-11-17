// The map editor's server side (environment-owned; mounted by one line in server.js, before the static files).
// Everything here exists only when the server runs with MAP_EDIT=1 (npm run edit). Otherwise /?edit=1, edit.html,
// js/editor.js and /api/map/* answer 404, so the live site doesn't serve the editor at all.
//   GET  /?edit=1          the editor page (public/edit.html)
//   GET  /api/map/models   the models in public/models and its kit folders, for the editor's palette (read-only)
//   GET  /api/map/status   { started } (round 29): when this server process started, so the editor's Test play can wait for the
//                          restart that `npm run edit` (node --watch) does after a save
//   POST /api/map/layout   write the map's layout file (?map=<id>, default the default map; round 29: public/shared/layout-keep.json; a
//                          server-only map (the frozen legacy layouts) is refused). Only when the server runs with MAP_EDIT=1 (npm run edit),
//                          only from this machine (loopback address, and a localhost Origin so another site open in
//                          the browser can't post to it), and only a layout that passes validateLayout(). The file it
//                          replaces is kept in tools/layout-backups/ (gitignored). Render never sets MAP_EDIT.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { MAPS, DEFAULT_MAP, formatLayout, validateLayout } from '../public/shared/map.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function mountMapEdit(app, root) {
  const fileOf = (name) => path.join(root, 'public', 'shared', (MAPS[name in MAPS ? name : DEFAULT_MAP] || MAPS[DEFAULT_MAP]).file);
  const backups = path.join(root, 'tools', 'layout-backups');
  const editing = () => process.env.MAP_EDIT === '1';
  app.use(['/edit.html', '/js/editor.js', '/api/map'], (req, res, next) => (editing() ? next() : res.status(404).send('Not found')));
  app.get('/', (req, res, next) => (!('edit' in req.query) ? next() : editing() ? res.sendFile(path.join(root, 'public', 'edit.html')) : res.status(404).send('Not found')));
  const started = Date.now();
  app.get('/api/map/status', (req, res) => res.json({ started }));
  // every .glb under public/models, with its folder: 'keep/wall', 'keep/props/keg', 'potion'
  app.get('/api/map/models', (req, res) => {
    const dir = path.join(root, 'public', 'models');
    try {
      const files = fs.readdirSync(dir, { recursive: true }).map(f => String(f).split(path.sep).join('/'));
      res.json(files.filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4)).sort());
    } catch { res.json([]); }
  });
  app.post('/api/map/layout', express.json({ limit: '4mb' }), (req, res) => {
    if (!LOOPBACK.has(req.socket.remoteAddress)) return res.status(403).json({ error: 'map editing only works from this computer' });
    const origin = req.get('origin');
    if (origin && !LOCAL_ORIGIN.test(origin)) return res.status(403).json({ error: 'map editing only works from localhost pages' });
    const bad = validateLayout(req.body);
    if (bad.length) return res.status(400).json({ error: bad.slice(0, 5).join('; ') });
    const name = String(req.query.map || DEFAULT_MAP);
    if (!(name in MAPS)) return res.status(400).json({ error: `no map ${name}` });
    if (MAPS[name].server) return res.status(400).json({ error: `${name} is a frozen map (the store builds' rooms): not editable` });
    const layoutFile = fileOf(name);
    try {
      fs.mkdirSync(backups, { recursive: true });
      if (fs.existsSync(layoutFile)) fs.copyFileSync(layoutFile, path.join(backups, `${path.basename(layoutFile, '.json')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const { version = 1, scatter = {}, entries, map } = req.body;
      fs.writeFileSync(layoutFile + '.tmp', formatLayout({ version, scatter, entries, ...(map && typeof map === 'object' ? { map } : {}) }));
      fs.renameSync(layoutFile + '.tmp', layoutFile);
      console.log(`[map edit] ${path.basename(layoutFile)} saved: ${entries.length} entries`);
      res.json({ ok: true, entries: entries.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
