// The map editor's server side (environment-owned; mounted by one line in server.js, before the static files).
//   GET  /?edit=1          the editor page (public/edit.html): anyone can look, nothing is written
//   GET  /api/map/models   the models in public/models, for the editor's palette (read-only)
//   POST /api/map/layout   write public/shared/layout.json. Only when the server runs with MAP_EDIT=1 (npm run edit),
//                          only from this machine (loopback address, and a localhost Origin so another site open in
//                          the browser can't post to it), and only a layout that passes validateLayout(). The file it
//                          replaces is kept in tools/layout-backups/ (gitignored). Render never sets MAP_EDIT.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { formatLayout, validateLayout } from '../public/shared/map.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function mountMapEdit(app, root) {
  const layoutFile = path.join(root, 'public', 'shared', 'layout.json');
  const backups = path.join(root, 'tools', 'layout-backups');
  app.get('/', (req, res, next) => ('edit' in req.query ? res.sendFile(path.join(root, 'public', 'edit.html')) : next()));
  app.get('/api/map/models', (req, res) => {
    fs.readdir(path.join(root, 'public', 'models'), (err, files) => res.json(err ? [] : files.filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4)).sort()));
  });
  app.post('/api/map/layout', express.json({ limit: '4mb' }), (req, res) => {
    if (process.env.MAP_EDIT !== '1') return res.status(403).json({ error: 'map editing is off: start the server with `npm run edit`' });
    if (!LOOPBACK.has(req.socket.remoteAddress)) return res.status(403).json({ error: 'map editing only works from this computer' });
    const origin = req.get('origin');
    if (origin && !LOCAL_ORIGIN.test(origin)) return res.status(403).json({ error: 'map editing only works from localhost pages' });
    const bad = validateLayout(req.body);
    if (bad.length) return res.status(400).json({ error: bad.slice(0, 5).join('; ') });
    try {
      fs.mkdirSync(backups, { recursive: true });
      if (fs.existsSync(layoutFile)) fs.copyFileSync(layoutFile, path.join(backups, `layout-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const { version = 1, scatter = {}, entries } = req.body;
      fs.writeFileSync(layoutFile + '.tmp', formatLayout({ version, scatter, entries }));
      fs.renameSync(layoutFile + '.tmp', layoutFile);
      console.log(`[map edit] layout.json saved: ${entries.length} entries`);
      res.json({ ok: true, entries: entries.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
