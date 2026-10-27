// Meadow goats: harmless grazers until something hits one. Then it rears up, charges whoever
// hit it, and rams the first wizard it reaches. A ram is fatal unless the wizard wards facing it.
//   graze -> wander -> graze ...            (idle)
//   (hit) -> windup -> charge -> recover    (charge ran out or reached the arena edge)
//                            \-> dizzy      (hit a pillar, a tree or a ward)

import * as C from '../public/shared/constants.js';

const G = C.GOAT;
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createGoats() {
  return C.GOAT_SPAWNS.slice(0, G.count).map(([x, z], i) => ({
    id: i + 1, x, z, yaw: Math.random() * Math.PI * 2,
    state: 'graze', until: rand(1, 5),     // seconds of grazing left (converted to absolute time on first update)
    target: null, angeredBy: null, dest: null, vx: 0, vz: 0, started: false,
  }));
}

export const goatPublic = (g) => ({ id: g.id, p: [round(g.x), round(g.z)], yaw: round(g.yaw), s: g.state, tgt: g.target });
const round = (v) => Math.round(v * 100) / 100;

// Something `ownerId` threw or cast hit this goat.
export function angerGoat(g, ownerId, ctx) {
  if (g.state === 'windup' || g.state === 'charge') return;
  const t = ctx.now();
  g.state = 'windup'; g.until = t + G.windup;
  g.target = ownerId; g.angeredBy = ownerId;
  ctx.broadcast({ t: 'goatAngry', id: g.id, target: ownerId });
}

// A ward stops the goat if the wizard is facing it (within the usual block cone).
function wardFacing(p, g) {
  if (!p.blocking || p.st <= 0) return false;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const dx = g.x - p.p[0], dz = g.z - p.p[2];
  return (fx * dx + fz * dz) / (Math.hypot(dx, dz) || 1) >= Math.cos((C.BLOCK_CONE_DEG / 2) * Math.PI / 180);
}

export function updateGoats(goats, dt, ctx) {
  const t = ctx.now();
  for (const g of goats) {
    if (!g.started) { g.started = true; g.until = t + g.until; }
    switch (g.state) {
      case 'graze':
        if (t >= g.until) { g.state = 'wander'; g.dest = pickDest(g); }
        break;
      case 'wander': {
        const dx = g.dest[0] - g.x, dz = g.dest[1] - g.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) { g.state = 'graze'; g.until = t + rand(3, 8); break; }
        turnToward(g, Math.atan2(dx, dz), 2.5 * dt);
        g.x += Math.sin(g.yaw) * G.walkSpeed * dt; g.z += Math.cos(g.yaw) * G.walkSpeed * dt;
        if (pushOut(g, ctx)) { g.state = 'graze'; g.until = t + rand(1, 3); }
        break;
      }
      case 'windup': {
        const tg = ctx.players.get(g.target);
        if (tg && !tg.dead) turnToward(g, Math.atan2(tg.p[0] - g.x, tg.p[2] - g.z), 8 * dt);
        if (t >= g.until) { g.state = 'charge'; g.until = t + G.chargeTime; }
        break;
      }
      case 'charge':
        charge(g, dt, t, ctx);
        break;
      case 'dizzy':
      case 'recover':
        if (t >= g.until) { g.state = 'graze'; g.until = t + rand(2, 5); g.target = null; }
        break;
    }
  }
}

function charge(g, dt, t, ctx) {
  const tg = ctx.players.get(g.target);
  if (tg && !tg.dead) turnToward(g, Math.atan2(tg.p[0] - g.x, tg.p[2] - g.z), G.turnRate * dt);
  g.vx = Math.sin(g.yaw) * G.chargeSpeed; g.vz = Math.cos(g.yaw) * G.chargeSpeed;
  g.x += g.vx * dt; g.z += g.vz * dt;

  // smash through standing props
  for (const prop of ctx.props.values()) {
    if (prop.state === 'idle' && Math.hypot(prop.x - g.x, prop.z - g.z) < C.PROP_TYPES[prop.type].r + G.radius) {
      ctx.breakProp(prop, [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z]);
    }
  }
  // ram the first wizard in reach
  for (const p of ctx.players.values()) {
    if (p.dead || Math.hypot(p.p[0] - g.x, p.p[2] - g.z) > G.radius + C.PLAYER_RADIUS + 0.25) continue;
    return ram(g, p, t, ctx);
  }
  // pillars and trees stop it cold
  for (const o of C.COLLIDERS) {
    if (Math.hypot(o.x - g.x, o.z - g.z) < o.r + G.radius) {
      pushOut(g, ctx);
      g.state = 'dizzy'; g.until = t + G.dizzyTime;
      ctx.broadcast({ t: 'goatBonk', id: g.id, p: [g.x, 0.8, g.z] });
      return;
    }
  }
  const r = Math.hypot(g.x, g.z);
  if (r > C.ARENA_RADIUS - 1 || t >= g.until) {
    pushOut(g, ctx);
    g.state = 'recover'; g.until = t + G.recoverTime;
  }
}

function ram(g, p, t, ctx) {
  const dir = [g.vx / G.chargeSpeed, 0, g.vz / G.chargeSpeed];
  if (wardFacing(p, g)) {
    // The ward holds. Expensive, and an empty ward shatters, but you live.
    const shattered = p.st < G.blockCost;
    p.st = Math.max(0, p.st - G.blockCost);
    if (shattered) {
      p.blocking = false; p.blockReleasedAt = t;
      p.stunUntil = Math.max(p.stunUntil, t + C.BLOCK_BREAK_STUN);
      ctx.broadcast({ t: 'blockBreak', id: p.id });
    }
    ctx.knockback(p, dir, G.blockKnockback);
    g.yaw = wrap(g.yaw + Math.PI);                   // bounced off
    g.x -= dir[0] * 0.8; g.z -= dir[2] * 0.8;
    g.state = 'dizzy'; g.until = t + G.dizzyTime;
    ctx.broadcast({ t: 'goatRam', id: g.id, target: p.id, blocked: true, dir, p: [p.p[0], 1, p.p[2]] });
    return;
  }
  ctx.broadcast({ t: 'goatRam', id: g.id, target: p.id, blocked: false, dir, p: [p.p[0], 1, p.p[2]] });
  // Whoever angered the goat gets the credit, unless it was their own goat that got them.
  const culprit = g.angeredBy !== p.id ? ctx.players.get(g.angeredBy) : null;
  p.lastHitBy = culprit ? culprit.id : null;
  ctx.killPlayer(p, culprit || null, 'goat');
  g.state = 'recover'; g.until = t + G.recoverTime;
}

function turnToward(g, want, maxStep) {
  const d = wrap(want - g.yaw);
  g.yaw = wrap(g.yaw + Math.max(-maxStep, Math.min(maxStep, d)));
}

// Keep the goat out of pillars, trees, props and the arena rim. Returns true if it bumped something.
function pushOut(g, ctx) {
  let hit = false;
  const out = (cx, cz, r) => {
    const dx = g.x - cx, dz = g.z - cz, d = Math.hypot(dx, dz);
    if (d < r + G.radius && d > 1e-4) { const k = (r + G.radius - d) / d; g.x += dx * k; g.z += dz * k; hit = true; }
  };
  for (const o of C.COLLIDERS) out(o.x, o.z, o.r);
  for (const prop of ctx.props.values()) if (prop.state === 'idle') out(prop.x, prop.z, C.PROP_TYPES[prop.type].r * 0.8);
  const r = Math.hypot(g.x, g.z), max = C.ARENA_RADIUS - 1.5;
  if (r > max) { g.x *= max / r; g.z *= max / r; hit = true; }
  return hit;
}

function pickDest(g) {
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, d = rand(3, 9);
    const x = g.x + Math.sin(a) * d, z = g.z + Math.cos(a) * d;
    if (Math.hypot(x, z) > C.ARENA_RADIUS - 4) continue;
    if (C.COLLIDERS.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 1.2)) continue;
    return [x, z];
  }
  return [g.x * 0.8, g.z * 0.8];
}
