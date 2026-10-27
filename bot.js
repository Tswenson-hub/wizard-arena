// Add AI opponents to a running server from the terminal:
//   node bot.js [count] [easy|normal|hard] [ws://host:port]
//   node bot.js clear [ws://host:port]
// Bots live on the server (see server/bots.js); you can also add them from the in-game menu.
import WebSocket from 'ws';

const args = process.argv.slice(2);
const clear = args[0] === 'clear';
const count = clear ? 0 : parseInt(args[0] || '1', 10);
const difficulty = ['easy', 'normal', 'hard'].find(d => args.includes(d)) || 'normal';
const url = args.find(a => a.startsWith('ws')) || `ws://localhost:${process.env.PORT || 3000}`;

const ws = new WebSocket(url);
ws.on('open', () => {
  if (clear) ws.send(JSON.stringify({ t: 'removeBots' }));
  for (let i = 0; i < count; i++) ws.send(JSON.stringify({ t: 'addBot', difficulty }));
  console.log(clear ? `Removed bots on ${url}` : `Added ${count} ${difficulty} bot(s) on ${url} (max 6).`);
  setTimeout(() => ws.close(), 200);
});
ws.on('error', (e) => { console.error(`Could not reach ${url}: ${e.message}`); process.exit(1); });
