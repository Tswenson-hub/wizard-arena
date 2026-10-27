// Simple AI opponents for testing alone:  node bot.js [count] [ws://host:port]
// Bots wander, face the nearest wizard, fire sparks, charge meteors, block, blink and throw props.
import WebSocket from 'ws';
import * as C from './public/shared/constants.js';

const count = parseInt(process.argv[2] || '1', 10);
const url = process.argv[3] || `ws://localhost:${process.env.PORT || 3000}`;
const NAMES = ['Zaltar', 'Morgra', 'Ebonyx', 'Pipsqueak', 'Vexlith', 'Grimble', 'Oswin', 'Thistle'];

function startBot(i) {
  const ws = new WebSocket(url);
  const me = { id: null, p: [0, 0, 0], yaw: 0, hp: 100, st: 100, dead: false, carrying: null };
  let players = new Map();
  let props = new Map();
  let charging = false, chargeAt = 0, blocking = false, blockUntil = 0;
  let nextDecision = 0, wander = [0, 0, 1];
  const now = () => Date.now() / 1000;
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? i : '');

  ws.on('open', () => send({ t: 'join', name }));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { me.id = m.id; for (const p of m.players) players.set(p.id, p); for (const pr of m.props) props.set(pr.id, pr); const self = m.players.find(p => p.id === me.id); me.p = self.p.slice(); }
    else if (m.t === 'snap') { for (const p of m.players) { players.set(p.id, p); if (p.id === me.id) { me.hp = p.hp; me.st = p.st; me.dead = p.dead; me.carrying = p.carrying; if (!p.charging) charging = false; if (!p.blocking) blocking = false; } } }
    else if (m.t === 'joined') players.set(m.player.id, m.player);
    else if (m.t === 'leave') players.delete(m.id);
    else if (m.t === 'prop') props.set(m.prop.id, m.prop);
    else if (m.t === 'propBreak') { const p = props.get(m.id); if (p) p.state = 'broken'; }
    else if (m.t === 'respawn' && m.id === me.id) me.p = m.p.slice();
    else if (m.t === 'tp' && m.id === me.id) me.p = m.to.slice();
    else if (m.t === 'chargeCancel' && m.id === me.id) charging = false;
  });
  ws.on('close', () => console.log(`${name} disconnected`));
  ws.on('error', (e) => console.log(`${name} error:`, e.message));

  const tick = setInterval(() => {
    if (!me.id || me.dead) return;
    const t = now();
    // nearest other wizard
    let target = null, bd = 1e9;
    for (const p of players.values()) {
      if (p.id === me.id || p.dead) continue;
      const d = Math.hypot(p.p[0] - me.p[0], p.p[2] - me.p[2]);
      if (d < bd) { bd = d; target = p; }
    }
    // face target or wander direction
    let dir = wander;
    if (target) { const dx = target.p[0] - me.p[0], dz = target.p[2] - me.p[2]; const l = Math.hypot(dx, dz) || 1; dir = [dx / l, 0, dz / l]; }
    me.yaw = Math.atan2(dir[0], dir[2]);

    // movement: keep ~8m from the target, strafe a little
    const dt = 0.05;
    let mv = [0, 0];
    if (target) {
      const strafe = Math.sin(t * 0.7 + i) * 0.8;
      const fwd = bd > 9 ? 1 : bd < 5 ? -1 : 0;
      mv = [dir[0] * fwd + dir[2] * strafe, dir[2] * fwd - dir[0] * strafe];
    } else mv = [wander[0], wander[2]];
    const ml = Math.hypot(mv[0], mv[1]) || 1;
    const speed = charging ? C.CHARGE_MOVE_SPEED : blocking ? C.BLOCK_MOVE_SPEED : C.MOVE_SPEED * 0.8;
    me.p[0] += mv[0] / ml * speed * dt; me.p[2] += mv[1] / ml * speed * dt;
    const r = Math.hypot(me.p[0], me.p[2]);
    if (r > C.ARENA_RADIUS - 2) { me.p[0] *= (C.ARENA_RADIUS - 2) / r; me.p[2] *= (C.ARENA_RADIUS - 2) / r; wander = [-me.p[0] / r, 0, -me.p[2] / r]; }
    for (const pil of C.PILLARS) { const dx = me.p[0] - pil.x, dz = me.p[2] - pil.z; const d = Math.hypot(dx, dz); if (d < pil.r + 0.6) { me.p[0] = pil.x + dx / d * (pil.r + 0.6); me.p[2] = pil.z + dz / d * (pil.r + 0.6); } }
    send({ t: 'state', p: me.p, yaw: me.yaw, anim: ml > 0.1 ? 'run' : 'idle' });

    // combat decisions
    if (charging && t >= chargeAt) { charging = false; send({ t: 'chargeRelease', dir: aim(target) }); }
    if (blocking && t >= blockUntil) { blocking = false; send({ t: 'block', on: false }); }
    if (t < nextDecision || charging || blocking) return;
    nextDecision = t + 0.5 + Math.random() * 0.8;
    if (!target) { if (Math.random() < 0.2) wander = [Math.random() - 0.5, 0, Math.random() - 0.5]; return; }
    const roll = Math.random();
    if (me.carrying) { send({ t: 'throw', dir: aim(target) }); return; }
    if (roll < 0.45 && bd < 26) send({ t: 'cast', kind: 'fast', dir: aim(target) });
    else if (roll < 0.65 && bd < 22) { charging = true; chargeAt = t + C.SPELLS.heavy.chargeTime + 0.1; send({ t: 'chargeStart' }); }
    else if (roll < 0.8 && me.st > 40) { blocking = true; blockUntil = t + 0.8 + Math.random(); send({ t: 'block', on: true }); }
    else if (roll < 0.88) send({ t: 'teleport', dir: [Math.random() - 0.5, 0, Math.random() - 0.5], from: me.p });
    else { // try a pickup
      for (const pr of props.values()) if (pr.state === 'idle' && Math.hypot(pr.x - me.p[0], pr.z - me.p[2]) < C.PICKUP_RANGE) { send({ t: 'pickup' }); break; }
    }
  }, 50);

  function aim(target) {
    if (!target) return [Math.sin(me.yaw), 0, Math.cos(me.yaw)];
    const dx = target.p[0] - me.p[0], dy = 1.0 - 1.3, dz = target.p[2] - me.p[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return [dx / l, dy / l, dz / l];
  }
  ws.on('close', () => clearInterval(tick));
}

for (let i = 0; i < count; i++) setTimeout(() => startBot(i), i * 300);
console.log(`Spawning ${count} bot(s) on ${url}. Ctrl+C to stop.`);
