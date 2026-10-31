// Serve a static build under a subpath, the way CrazyGames hosts the files (deploy-owned test helper).
//   node tools/serve-subpath.mjs <dir> [port=4199] [prefix=/game]
// Logs every request outside the prefix and every 404, which is how an absolute URL shows up.
import express from 'express';
import path from 'node:path';
const [dir = 'dist/crazygames', port = 4199, prefix = '/game'] = process.argv.slice(2);
const app = express();
app.use((req, res, next) => { res.on('finish', () => { const u = req.originalUrl.split('?')[0]; if (!u.startsWith(prefix + '/') || res.statusCode >= 400) console.log(`[subpath] ${res.statusCode} ${u}`, res.statusCode >= 400 ? JSON.stringify({ ref: req.get("referer"), dest: req.get("sec-fetch-dest"), mode: req.get("sec-fetch-mode"), ua: (req.get("user-agent") || "").slice(0, 40) }) : ""); }); next(); });
app.use((req, res, next) => (req.originalUrl === prefix ? res.redirect(prefix + '/') : next()));
app.use(prefix, express.static(path.resolve(dir)));
app.listen(+port, () => console.log(`serving ${dir} at http://localhost:${port}${prefix}/`));
