// Farm goats: harmless grazers in the pen until something hits one. Then it rears up, leaps the
// fence (charges ignore fence posts and trample crops), charges whoever hit it, and rams the first
// wizard it reaches. A ram is fatal unless the wizard wards facing it. Then it trots home through the gate.
//   graze -> wander -> graze ...                      (idle, always inside the pen)
//   (hit) -> windup -> charge -> recover -> return    (charge ran out or reached the arena edge)
//                            \-> dizzy   -> return    (hit a pillar, a tree, the house or a ward)
//   return: around the pen to the gate, in, then graze

import * as C from '../public/shared/constants.js';

const G = C.GOAT;
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createGoats() {
  return C.GOAT_SPAWNS.slice(0, G.count).map(([x, z], i) => ({
    id: i + 1, x, z, yaw: Math.random() * Math.PI * 2,
    state: 'graze', until: rand(1, 5),     // seconds of grazing left (converted to absolute time on first update)
    target: null, angeredBy: null, dest: null, vx: 0, vz: 0, started: false,
    route: null, routeT: 0, checkT: 0, checkPos: null, detours: 0,
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

// Knock a charging (or winding-up) goat dizzy, as if it hit a pillar: Arcane Cyclone answering a charge.
export function dizzyGoat(g, ctx) {
  if (g.state !== 'charge' && g.state !== 'windup') return false;
  g.state = 'dizzy'; g.until = ctx.now() + G.dizzyTime;
  ctx.broadcast({ t: 'goatBonk', id: g.id, p: [g.x, 0.8, g.z] });
  return true;
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
        if (t >= g.until) {
          if (C.inPen(g.x, g.z, 0.3)) { g.state = 'wander'; g.dest = pickDest(g); }
          else goHome(g, t);
        }
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
        if (t >= g.until) {
          g.target = null;
          if (C.inPen(g.x, g.z, 0.3)) { g.state = 'graze'; g.until = t + rand(2, 5); }
          else goHome(g, t);
        }
        break;
      case 'return':
        trotHome(g, dt, t, ctx);
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
  // ram the first wizard in reach (it runs under anyone up in the air)
  for (const p of ctx.players.values()) {
    if (p.dead || p.p[1] >= G.rammableBelow || Math.hypot(p.p[0] - g.x, p.p[2] - g.z) > G.radius + C.PLAYER_RADIUS + 0.25) continue;
    return ram(g, p, t, ctx);
  }
  // pillars, trees, the house and the tractor stop it cold; it leaps fences and tramples crops
  for (const o of C.COLLIDERS) {
    if (o.kind === 'fence' || o.kind === 'crop') continue;
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
  if (g.ghost) return false;
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

// Somewhere to graze inside the pen, not too far from where the goat stands.
function pickDest(g) {
  const m = 1.3;
  for (let i = 0; i < 20; i++) {
    const x = rand(C.PEN.x0 + m, C.PEN.x1 - m), z = rand(C.PEN.z0 + m, C.PEN.z1 - m);
    if (i < 12 && Math.hypot(x - g.x, z - g.z) > 9) continue;
    if (C.COLLIDERS.some(o => o.kind !== 'fence' && Math.hypot(o.x - x, o.z - z) < o.r + 1.2)) continue;
    return [x, z];
  }
  return [(C.PEN.x0 + C.PEN.x1) / 2, (C.PEN.z0 + C.PEN.z1) / 2];
}

// ---------------------------------------------------------------- going home
// Route: around the outside of the pen (via its corners) to the gate, through it, then a grazing spot.
// The barn and the fallen silo are boxes the route also goes around, by their corners.
const PAD = 1.9;
const PEN_BOX = { x0: C.PEN.x0, x1: C.PEN.x1, z0: C.PEN.z0, z1: C.PEN.z1 };
const BOXES = [[PEN_BOX, 0.5], ...C.GOAT_DETOURS.map(b => [b, 0.6])];   // [box, how much a route must clear it by]
const CORNERS = BOXES.flatMap(([b], i) => {
  const pad = i ? PAD - 0.6 : PAD;
  return [[b.x0 - pad, b.z0 - pad], [b.x1 + pad, b.z0 - pad], [b.x1 + pad, b.z1 + pad], [b.x0 - pad, b.z1 + pad]];
}).filter(([x, z]) => Math.hypot(x, z) < C.ARENA_RADIUS - 1);

// Does segment a-b cross box b (grown by `grow`)? Liang-Barsky clip.
function crossesBox(a, c, b, grow) {
  let t0 = 0, t1 = 1;
  const dx = c[0] - a[0], dz = c[1] - a[1];
  const edges = [[-dx, a[0] - (b.x0 - grow)], [dx, (b.x1 + grow) - a[0]], [-dz, a[1] - (b.z0 - grow)], [dz, (b.z1 + grow) - a[1]]];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
// A goat already inside a box's grown margin (it was knocked there) only has to clear the box itself.
const inBox = (p, b, grow) => p[0] > b.x0 - grow && p[0] < b.x1 + grow && p[1] > b.z0 - grow && p[1] < b.z1 + grow;
const blocked = (a, c) => BOXES.some(([b, grow], i) => crossesBox(a, c, b, i && inBox(a, b, grow) ? 0 : grow));

// Shortest path from `from` to the gate over the corner waypoints (plain Dijkstra, a dozen nodes).
export function routeToGate(from) {
  const nodes = [from, ...CORNERS, C.PEN.gateOut];
  const goal = nodes.length - 1;
  const dist = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    if (u === goal) break;
    for (let v = 1; v < nodes.length; v++) {
      if (done[v] || blocked(nodes[u], nodes[v])) continue;
      const d = dist[u] + Math.hypot(nodes[v][0] - nodes[u][0], nodes[v][1] - nodes[u][1]);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  const path = [];
  for (let v = goal; v > 0; v = prev[v]) { if (v < 0) return [C.PEN.gateOut]; path.unshift(nodes[v]); }
  return path;
}

function goHome(g, t) {
  g.state = 'return';
  g.route = [...routeToGate([g.x, g.z]), C.PEN.gateIn, pickDest({ x: C.PEN.gateIn[0], z: C.PEN.gateIn[1] })];
  g.routeT = t; g.checkT = t; g.checkPos = [g.x, g.z]; g.detours = 0; g.ghost = false;
}

function trotHome(g, dt, t, ctx) {
  const wp = g.route[0];
  const dx = wp[0] - g.x, dz = wp[1] - g.z;
  if (Math.hypot(dx, dz) < 0.6) {
    g.route.shift();
    if (!g.route.length) { g.state = 'graze'; g.until = t + rand(2, 5); g.ghost = false; }
    return;
  }
  turnToward(g, Math.atan2(dx, dz), 4 * dt);
  g.x += Math.sin(g.yaw) * G.trotSpeed * dt; g.z += Math.cos(g.yaw) * G.trotSpeed * dt;
  pushOut(g, ctx);
  // Stuck on something (the house, a tractor, a prop pile)? Step aside, and after a long time just
  // hop everything on the way home.
  if (t - g.checkT > 1.5) {
    if (Math.hypot(g.x - g.checkPos[0], g.z - g.checkPos[1]) < 0.6) {
      const side = g.detours++ % 2 ? 1 : -1, a = g.yaw + side * Math.PI / 2;
      g.route.unshift([g.x + Math.sin(a) * 2.5, g.z + Math.cos(a) * 2.5]);
    }
    g.checkT = t; g.checkPos = [g.x, g.z];
  }
  if (t - g.routeT > 30) g.ghost = true;
}
