// Farm goats: harmless grazers in the pen until something hits one. Then it rears up, leaps the
// fence (charges ignore fence posts and trample crops), charges whoever hit it, and rams the first
// wizard it reaches. A ram is fatal unless the wizard wards facing it. Then it trots home through the gate.
//   graze -> wander -> graze ...                      (idle, always inside the pen)
//   (hit) -> windup -> charge -> recover -> return    (charge ran out or reached the arena edge)
//                            \-> dizzy   -> return    (hit a pillar, a tree, the house or a ward)
//   return: around the pen to the gate, in, then graze
// Telekinesis can pick a calm goat up and hurl it like a prop that doesn't break (see liftGoat / throwGoat).
// None of that angers it; only a spell does, held and flying goats included:
//   graze|wander|return|recover|dizzy|stumble -> held -> flying -> stumble -> graze/wander (in the pen) or return
//                                                   \-> stumble (dropped)      (spell) -> drops -> windup
// Jeb the Shepherd summons rams (summonRam): golden goats in the same array that never pen. They charge
// dead straight, circle him (orbit) until an enemy's shot sends one charging at the shooter, or carry him
// (mount). Once spent they vanish (goatGone). callRam sends a calm map goat at someone, credited to him.
//   charge -> dizzy|recover -> gone        orbit -> (shot) -> windup -> charge -> ...  | -> gone (time up)
//   mount -> gone (despawnRam, or the owner is down)

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
    y: 0, vy: 0, holder: null, thrower: null, flyT: 0, hitIds: null,   // telekinesis: height above ground, flight
  }));
}

export const goatPublic = (g) => {
  const o = { id: g.id, p: [round(g.x), round(g.z)], yaw: round(g.yaw), s: g.state, tgt: g.target, y: round(g.y), holder: g.holder };
  if (g.summoned) {
    o.summoned = true; o.owner = g.owner; o.team = g.team;
    if (g.speed !== G.chargeSpeed) o.speed = g.speed;
    if (g.state === 'orbit') o.orb = [g.orbitR, g.orbitLap];   // lets clients run the circle between snapshots
  }
  if (g.state === 'flying') o.v = [round(g.vx), round(g.vy), round(g.vz)];   // lets clients extrapolate the arc
  return o;
};
const round = (v) => Math.round(v * 100) / 100;

// A spell `ownerId` cast hit this goat. A held or flying goat drops to the ground first (a held one
// takes the hit for its holder), then rears up at the caster like any other.
// Returns true if the goat is now after the caster.
// A summoned ram only answers an enemy of its owner, and only while it circles him: it breaks orbit and
// charges the shooter (a short rear-up), with the kill credited to its owner. Anything else leaves it be.
export function angerGoat(g, ownerId, ctx) {
  if (g.summoned) {
    if (g.state !== 'orbit' || !hostile(g, ctx.players.get(ownerId), ctx)) return false;
    const t = ctx.now();
    g.state = 'windup'; g.until = t + RAM_WINDUP; g.target = ownerId; g.speed = G.chargeSpeed; g.maxTime = G.chargeTime;
    ctx.broadcast({ t: 'goatAngry', id: g.id, target: ownerId, owner: g.owner });
    return true;
  }
  if (g.state === 'windup' || g.state === 'charge') return false;
  if (g.state === 'held' || g.state === 'flying') toGround(g, ctx);
  const t = ctx.now();
  g.state = 'windup'; g.until = t + G.windup;
  g.target = ownerId; g.angeredBy = ownerId; g.calledBy = null;
  ctx.broadcast({ t: 'goatAngry', id: g.id, target: ownerId });
  return true;
}

// ---------------------------------------------------------------- Jeb's rams
const RAM_WINDUP = 0.3;          // an orbiting ram that was shot rears up this briefly before it charges
let nextRamId = 1000;            // summoned ids never clash with the map goats'
const pending = [];              // rams summoned without ctx.goats join the array on the next update
const CALM = new Set(['graze', 'wander', 'return', 'recover', 'dizzy', 'stumble']);

// Would this goat run `p` down? A summoned ram (or a map goat Jeb called) passes its owner and his team.
function hostile(g, p, ctx) {
  if (!p) return false;
  const oid = g.summoned ? g.owner : g.calledBy;
  if (oid == null) return true;
  if (p.id === oid) return false;
  const o = ctx.players.get(oid);
  if (!o) return true;
  return ctx.isEnemy ? ctx.isEnemy(o, p) : !(o.team && o.team === p.team);
}

// opts: { x, z, yaw, ownerId, mode: 'charge' | 'orbit' | 'mount', targetId?, speed?, maxTime?, radius?, lap? }
//   charge: dead straight along yaw (homing only if targetId is given) until a collider (dizzy), a wizard
//           (ram) or maxTime (recover); then it vanishes.
//   orbit:  circles the owner (radius / lap, default GOAT.orbitRadius / orbitLap) for maxTime (GOAT.orbitTime), then vanishes.
//   mount:  no AI: server.js sets x / z / yaw under the rider each tick and calls despawnRam at the dismount.
// The ram goes into ctx.goats when the ctx has it, otherwise into the array on the next updateGoats.
export function summonRam(opts, ctx) {
  const t = ctx.now(), owner = ctx.players.get(opts.ownerId);
  const mode = opts.mode || 'charge';
  const g = {
    id: nextRamId++, x: opts.x, z: opts.z, yaw: opts.yaw || 0, y: 0, vx: 0, vy: 0, vz: 0,
    summoned: true, owner: opts.ownerId, team: owner?.team ?? null, started: true,
    state: mode, target: opts.targetId ?? null, angeredBy: opts.ownerId, calledBy: null,
    speed: opts.speed ?? G.chargeSpeed, maxTime: opts.maxTime ?? (mode === 'orbit' ? G.orbitTime : G.chargeTime),
    holder: null, thrower: null, hitIds: null, route: null, dest: null, ghost: false,
    born: t, orbitA: 0, orbitR: opts.radius ?? G.orbitRadius, orbitLap: opts.lap ?? G.orbitLap,
  };
  g.until = t + g.maxTime;
  g.dieAt = t + Math.max(G.ramLife, g.maxTime + G.dizzyTime + 1);
  if (mode === 'orbit' && owner) {
    // start where it stands (the spells side spaces the three of them out)
    g.orbitA = Math.atan2(g.x - owner.p[0], g.z - owner.p[2]);
    placeOrbit(g, owner);
  }
  if (Array.isArray(ctx.goats)) ctx.goats.push(g); else pending.push(g);
  return g;
}

// Remove a summoned ram now (the dismount, or the spells side clearing up), with a goatGone broadcast.
export function despawnRam(g, ctx) {
  if (!g?.summoned) return;
  g.state = 'gone';
  if (ctx) sweep(lastGoats, ctx);
}
// Take every spent ram out of the array (and the pending list) and tell the clients.
function sweep(goats, ctx) {
  for (const list of [goats, pending]) for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    if (!g.summoned || g.state !== 'gone') continue;
    list.splice(i, 1);
    ctx.broadcast({ t: 'goatGone', id: g.id, p: [round(g.x), round(g.z)] });
  }
}

// Send the nearest calm map goat within `range` of `from` ([x, z], [x, y, z] or {x, z}) at targetId,
// rearing up as usual; the kill goes to creditId, and it passes creditId and his team. Null if none.
export function callRam(targetId, creditId, from, range, ctx) {
  const fx = Array.isArray(from) ? from[0] : from.x, fz = Array.isArray(from) ? from[from.length - 1] : from.z;
  let best = null, bd = range;
  for (const g of ctx.goats || lastGoats) {
    if (g.summoned || !CALM.has(g.state) || g.holder) continue;
    const d = Math.hypot(g.x - fx, g.z - fz);
    if (d <= bd) { bd = d; best = g; }
  }
  if (!best) return null;
  best.state = 'windup'; best.until = ctx.now() + G.windup; best.ghost = false;
  best.target = targetId; best.angeredBy = creditId; best.calledBy = creditId;
  ctx.broadcast({ t: 'goatAngry', id: best.id, target: targetId, caller: creditId });
  return best;
}
let lastGoats = [];

function placeOrbit(g, owner) {
  g.x = owner.p[0] + Math.sin(g.orbitA) * g.orbitR;
  g.z = owner.p[2] + Math.cos(g.orbitA) * g.orbitR;
  g.yaw = wrap(g.orbitA + Math.PI / 2);     // running round him, counter-clockwise seen from above
}

// ---------------------------------------------------------------- telekinesis
const LIFTABLE = new Set(['graze', 'wander', 'return', 'recover', 'dizzy', 'stumble']);
export const canLift = (g) => !g.summoned && LIFTABLE.has(g.state) && !g.holder;

export function liftGoat(g, holderId, ctx) {
  if (!canLift(g)) return false;
  g.state = 'held'; g.holder = holderId; g.target = null; g.ghost = false;
  placeHeld(g, ctx);
  return true;
}

// Set down gently where it floats; it stumbles, then carries on.
export function releaseGoat(g, ctx) {
  if (g.state !== 'held') return;
  land(g, ctx);
}

// Hurled like a prop: SPELLS.prop's speed and gravity (C.GOAT.throwSpeed / throwGravity).
export function throwGoat(g, throwerId, origin, dir, ctx) {
  if (g.state !== 'held') return false;
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  g.state = 'flying'; g.holder = null; g.thrower = throwerId; g.flyT = 0; g.hitIds = new Set();
  g.x = origin[0]; g.y = Math.max(0, origin[1] - G.hitY); g.z = origin[2];
  g.vx = dir[0] / l * G.throwSpeed; g.vy = dir[1] / l * G.throwSpeed; g.vz = dir[2] / l * G.throwSpeed;
  return true;
}

function placeHeld(g, ctx) {
  const h = ctx.players.get(g.holder);
  if (!h || h.dead || h.stunUntil > ctx.now()) { releaseGoat(g, ctx); return; }
  const hp = C.holdPoint(h.p, h.yaw);
  g.x = hp[0]; g.z = hp[2]; g.y = Math.max(0, hp[1] - G.hitY); g.yaw = h.yaw;
}

function toGround(g, ctx) {
  g.holder = null; g.thrower = null; g.hitIds = null; g.y = 0; g.vx = g.vz = g.vy = 0;
  g.ghost = false; pushOut(g, ctx);
}

// On its feet again: a short stumble, then back to whatever a calm goat does (see 'stumble').
function land(g, ctx) {
  toGround(g, ctx);
  g.state = 'stumble'; g.until = ctx.now() + G.stumbleTime; g.target = null;
}

function fly(g, dt, ctx) {
  g.flyT += dt;
  g.vy -= G.throwGravity * dt;
  g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
  if (Math.hypot(g.vx, g.vz) > 0.5) g.yaw = Math.atan2(g.vx, g.vz);
  // a wizard (not the thrower) takes a prop's hit; the goat bounces off and keeps falling
  for (const p of ctx.players.values()) {
    if (p.dead || p.id === g.thrower || g.hitIds.has(p.id)) continue;
    const d = Math.hypot(g.x - p.p[0], g.y + G.hitY - (p.p[1] + C.HIT_CENTER_Y), g.z - p.p[2]);
    if (d >= C.HIT_RADIUS + G.radius * 0.8) continue;
    g.hitIds.add(p.id);
    ctx.goatHitPlayer?.(g, p, g.thrower);
    g.vx *= -0.15; g.vz *= -0.15; g.vy = Math.min(g.vy, 0);
  }
  // ground, anything solid it's low enough to hit (Bulwark walls included), the rim, or a very long flight
  let stop = g.y <= 0 || g.flyT > 5 || Math.hypot(g.x, g.z) > C.ARENA_RADIUS - 0.5;
  for (const o of C.COLLIDERS) if (!stop && g.y < o.h && Math.hypot(o.x - g.x, o.z - g.z) < o.r + G.radius) stop = true;
  if (!stop && C.SURFACES?.length && C.surfaceSolidAt(g.x, g.y + 0.3, g.z, true)) stop = true;   // a platform's solid part (it then steps off to the ground)
  if (stop) { ctx.broadcast({ t: 'goatBonk', id: g.id, p: [g.x, 0.8, g.z] }); land(g, ctx); }
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
  if (C.SPELLBOOK[p.loadout?.guard]?.allSides) return true;   // an all-round shield (Black Death) covers every side
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const dx = g.x - p.p[0], dz = g.z - p.p[2];
  return (fx * dx + fz * dz) / (Math.hypot(dx, dz) || 1) >= Math.cos((C.BLOCK_CONE_DEG / 2) * Math.PI / 180);
}

export function updateGoats(goats, dt, ctx) {
  const t = ctx.now();
  lastGoats = goats;
  if (pending.length) goats.push(...pending.splice(0));
  for (let i = goats.length - 1; i >= 0; i--) {
    const g = goats[i];
    if (!g.summoned) continue;
    const owner = ctx.players.get(g.owner);
    const down = !owner || owner.dead;
    if (t >= g.dieAt || ((g.state === 'orbit' || g.state === 'mount') && down)) g.state = 'gone';
  }
  sweep(goats, ctx);
  for (const g of goats) {
    if (!g.started) { g.started = true; g.until = t + g.until; }
    if (g.summoned && updateRam(g, dt, t, ctx)) continue;
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
      case 'held':
        placeHeld(g, ctx);
        break;
      case 'flying':
        fly(g, dt, ctx);
        break;
      case 'dizzy':
      case 'recover':
      case 'stumble':
        if (t >= g.until) {
          g.target = null; g.calledBy = null;
          if (C.inPen(g.x, g.z, 0.3)) { g.state = 'graze'; g.until = t + rand(2, 5); }
          else goHome(g, t);
        }
        break;
      case 'return':
        trotHome(g, dt, t, ctx);
        break;
    }
  }
  sweep(goats, ctx);       // rams that were spent this tick never reach a snapshot
}

// The parts of a summoned ram's life that differ from a goat's. True if handled.
// (A ram that ends its life here is marked 'gone' and swept at the end of updateGoats.)
function updateRam(g, dt, t, ctx) {
  switch (g.state) {
    case 'orbit': {
      const owner = ctx.players.get(g.owner);
      g.orbitA = wrap(g.orbitA + dt * Math.PI * 2 / g.orbitLap);
      placeOrbit(g, owner);
      if (t >= g.until) g.state = 'gone';
      return true;
    }
    case 'mount':
      return true;                          // server.js moves it under the rider
    case 'windup':
      if (t >= g.until) { g.state = 'charge'; g.until = t + g.maxTime; return true; }
      return false;                         // turns toward the shooter like a goat
    case 'dizzy':
    case 'recover':
    case 'stumble':
      if (t >= g.until) g.state = 'gone';   // spent: it vanishes on the next update
      return true;
  }
  return false;
}

function charge(g, dt, t, ctx) {
  const tg = ctx.players.get(g.target);
  if (tg && !tg.dead) turnToward(g, Math.atan2(tg.p[0] - g.x, tg.p[2] - g.z), G.turnRate * dt);
  const speed = g.speed || G.chargeSpeed;
  g.vx = Math.sin(g.yaw) * speed; g.vz = Math.cos(g.yaw) * speed;
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
    if (!hostile(g, p, ctx)) continue;      // Jeb's rams run past him and his team
    return ram(g, p, t, ctx);
  }
  // pillars, trees, the house and the tractor stop it cold; it leaps fences and tramples crops
  if (C.SURFACES?.length) {
    const [x, z] = C.surfacePushOut(g.x, g.z, -1, G.radius);
    if (x !== g.x || z !== g.z) {   // ran into a platform's side
      g.x = x; g.z = z;
      g.state = 'dizzy'; g.until = t + G.dizzyTime;
      ctx.broadcast({ t: 'goatBonk', id: g.id, p: [g.x, 0.8, g.z] });
      return;
    }
  }
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
  if (g.state !== 'charge') return;             // held and flying goats never ram
  const sp = Math.hypot(g.vx, g.vz) || 1, dir = [g.vx / sp, 0, g.vz / sp];
  if (p.veilUntil > t) {
    // Gale's Tempest Veil: the goat bounces off from any side, at no cost to her
    g.yaw = wrap(g.yaw + Math.PI);
    g.x -= dir[0] * 0.8; g.z -= dir[2] * 0.8;
    g.state = 'dizzy'; g.until = t + G.dizzyTime;
    ctx.broadcast({ t: 'goatRam', id: g.id, target: p.id, blocked: true, veil: true, dir, p: [p.p[0], 1, p.p[2]] });
    return;
  }
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
  ctx.killPlayer(p, culprit || null, g.summoned ? 'ram' : 'goat');
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
  // platforms and ramps: goats stay on the ground, so every footprint is in the way
  if (C.SURFACES?.length) {
    const [x, z] = C.surfacePushOut(g.x, g.z, -1, G.radius);
    if (x !== g.x || z !== g.z) { g.x = x; g.z = z; hit = true; }
  }
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
// Platforms and ramps (C.SURFACES) are rotated rectangles: a route leg must clear each by SURF_GROW, and their
// corners pushed out by SURF_PAD are extra waypoints (the box waypoints would wall off the ground round them).
// (decks high enough to walk under don't count: a goat trots underneath)
const SURFS = (C.SURFACES || []).filter(s => !(s.thick && Math.min(s.kind === 'ramp' ? Math.min(s.y0, s.y1) : s.top) - s.thick > 1.0));
const SURF_GROW = G.radius + 0.05, SURF_PAD = G.radius + 0.9;
const surfLocal = (s, x, z) => { const dx = x - s.x, dz = z - s.z, c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0); return [dx * c - dz * n, dx * n + dz * c]; };
function crossesSurf(a, c, s, grow) {
  const [ax, az] = surfLocal(s, a[0], a[1]), [cx, cz] = surfLocal(s, c[0], c[1]);
  return crossesBox([ax, az], [cx, cz], { x0: -s.w / 2, x1: s.w / 2, z0: -s.d / 2, z1: s.d / 2 }, grow);
}
const inSurf = (p, grow) => SURFS.some(s => { const [lx, lz] = surfLocal(s, p[0], p[1]); return Math.abs(lx) < s.w / 2 + grow && Math.abs(lz) < s.d / 2 + grow; });
const CORNERS = [
  ...BOXES.flatMap(([b], i) => {
    const pad = i ? PAD - 0.6 : PAD;
    return [[b.x0 - pad, b.z0 - pad], [b.x1 + pad, b.z0 - pad], [b.x1 + pad, b.z1 + pad], [b.x0 - pad, b.z1 + pad]];
  }),
  ...SURFS.flatMap(s => C.surfaceCorners({ ...s, w: s.w + 2 * SURF_PAD, d: s.d + 2 * SURF_PAD })),
].filter(([x, z]) => Math.hypot(x, z) < C.ARENA_RADIUS - 1 && !inSurf([x, z], SURF_GROW));

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
const blocked = (a, c) => BOXES.some(([b, grow], i) => crossesBox(a, c, b, i && inBox(a, b, grow) ? 0 : grow))
  || SURFS.some(s => crossesSurf(a, c, s, SURF_GROW));

// Shortest path from `from` to the gate over the corner waypoints (plain Dijkstra, a dozen nodes).
export function routeToGate(from) {
  // knocked onto (or against) a platform's footprint: plan from just outside it
  if (SURFS.length && inSurf(from, SURF_GROW)) from = C.surfacePushOut(from[0], from[1], -1, SURF_GROW + 0.05);
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
  g.state = 'return'; g.calledBy = null;
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
      if (++g.detours % 3 === 0) {
        // still stuck after two side-steps: plan again from here (the ghost timer keeps running)
        const routeT = g.routeT, detours = g.detours;
        goHome(g, t); g.routeT = routeT; g.detours = detours;
      } else {
        const side = g.detours % 2 ? 1 : -1, a = g.yaw + side * Math.PI / 2;
        g.route.unshift([g.x + Math.sin(a) * 2.5, g.z + Math.cos(a) * 2.5]);
      }
    }
    g.checkT = t; g.checkPos = [g.x, g.z];
  }
  if (t - g.routeT > 40) g.ghost = true;   // the far west edge to the gate is a 30 s trot
}
