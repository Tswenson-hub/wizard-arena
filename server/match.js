// The match (round 11: one mode only). A 4-player free-for-all: humans first, bots fill up to 4, a 5th human
// watches as a spectator until a place opens. First to 15 kills, or the most kills at the 7-minute cap.
// Loop: countdown (3 s, nothing scores; round 16: no warm-up) → live → end (a 1.5 s gap: the last kill sinks in) → recap
// (10 s: the podium, the top three's accolades) → an immediate rematch (countdown ...).
// Spells agent (round 11; it was the modes agent's).
//
// Hooks: server.js calls these.
//   isEnemy(a, b)            players: may a hurt b? (anyone but yourself, outside the intermission)
//   spawnPointFor(p)         [x, 0, z, yaw]: an FFA spawn near the fight but not on it (C.SPAWN_CHOICE)
//   onJoin(p) / onLeave(p)   a human or bot entered or left (a bot with no room is removed again at once)
//   onDamage(target, attacker, dmg, from)   attacker may be undefined (the environment); from: a projectile's launch point
//   onKill(target, attacker, cause)
//   onHeal(p, amount, src)   health actually gained from a spell or a potion (natural regen doesn't come here)
//   onPotion(p) / onAirJump(p) / onTrap(curser)   a health potion drunk, a double jump, a Trapped Relic going off
//   onPickup / onDrop / onPropBroken / canThrow   prop hooks (no rules use them now)
//   tick(dt)                 every simulation step
//   handle(p, msg)           messages server.js doesn't know (matchDebug, matchStats)
//   playerExtras(p)          merged into playerPublic ({ dmg, spectator })
//   snapshotExtras()         merged into every 'snap' broadcast ({ match })
//   welcomeExtras(p)         merged into the 'welcome' message
//
// ctx (from server.js): { players, props, now, broadcast, send, addBot, removePlayer, respawn, propPublic,
//   addUltCharge(p, pct) }, plus optional resetRams() and resetUlt(p).
// Debug (only with MATCH_DEBUG=1 in the server's environment): { t: 'matchDebug', target, cap, countdown (or warmup), endTime, recapTime,
// botDiff, skip: true, spectate: true, pinBots: true | false, size }.

import * as C from '../public/shared/constants.js';

export const FFA = { name: 'Free-for-all', size: 4, target: 15, cap: 420 };   // round 14 (pacing): 10 / 480
const TIMES = { countdown: 3, end: 1.5, recap: 10 };   // round 16 (Ty): a 3 s countdown, then go (was a 10 s warm-up); the end's gap, then the recap
const ASSIST_WINDOW = 10;   // s: damage this recent to the victim, by someone other than the killer, is an assist
// Round 16 (Ty): the recap's accolades. stat(p) -> the number; low: fewer is better; min: the least that earns it; text: the value shown;
// icon: podium.js's icon id, or a symbol it shows as is.
const n0 = (v) => Math.round(v).toLocaleString('en-US');
export const ACCOLADES = [
  { id: 'kills', icon: 'kills', label: 'Most Kills', stat: p => p.kills || 0, min: 1, text: v => `${n0(v)} kill${v === 1 ? '' : 's'}` },
  { id: 'damage', icon: 'damage', label: 'Most Damage', stat: p => p.mDmg || 0, min: 1, text: v => `${n0(v)} damage` },
  { id: 'untouchable', icon: 'survivor', label: 'Untouchable', stat: p => p.deaths || 0, low: true, text: v => `${n0(v)} death${v === 1 ? '' : 's'}` },
  { id: 'healing', icon: 'heal', label: 'Most Healing', stat: p => p.ms?.healed || 0, min: 1, text: v => `${n0(v)} healed` },
  { id: 'heavy', icon: '✦', label: 'Heavy Hitter', stat: p => p.ms?.biggest || 0, min: 1, text: v => `${n0(v)} in one hit` },
  { id: 'sharpshooter', icon: 'accuracy', label: 'Sharpshooter', stat: p => p.ms?.longest || 0, min: 5, text: v => `a ${n0(v)} m hit` },
  { id: 'assists', icon: '⚑', label: 'Assist King', stat: p => p.ms?.assists || 0, min: 1, text: v => `${n0(v)} assist${v === 1 ? '' : 's'}` },
  { id: 'traps', icon: '☠', label: 'Trapmaster', stat: p => p.ms?.traps || 0, min: 1, text: v => `${n0(v)} trap${v === 1 ? '' : 's'} sprung` },
  { id: 'potions', icon: '⚗', label: 'Potion Hunter', stat: p => p.ms?.potions || 0, min: 1, text: v => `${n0(v)} potion${v === 1 ? '' : 's'}` },
  { id: 'acrobat', icon: '⤴', label: 'Acrobat', stat: p => p.ms?.airJumps || 0, min: 1, text: v => `${n0(v)} double jump${v === 1 ? '' : 's'}` },
];
const freshStats = () => ({ assists: 0, dmgTaken: 0, healed: 0, potions: 0, longest: 0, airJumps: 0, traps: 0, biggest: 0 });
// Placing: kills, then fewer deaths, then damage (then who joined first, so it's stable)
export const byPlace = (a, b) => (b.kills || 0) - (a.kills || 0) || (a.deaths || 0) - (b.deaths || 0) || (b.mDmg || 0) - (a.mDmg || 0) || a.id - b.id;
// The podium's accolades: each of the top three gets 1–2 titles, none repeated. A title is someone's when they're the best
// at it among everyone who played (ties go to the better placing). Round 1, in placing order, each takes the first such
// title in ACCOLADES order; a player who leads none takes the title they lead among the podium places from theirs down
// (so 3rd always gets one when they did anything). Round 2: a second title they lead outright.
export function pickAccolades(ranked) {
  const podium = ranked.slice(0, 3), taken = new Set(), out = new Map(podium.map(p => [p.id, []]));
  const place = new Map(ranked.map((p, i) => [p.id, i]));
  const better = (A, a, b) => { const x = A.stat(a), y = A.stat(b); return (A.low ? x < y : x > y) || (x === y && place.get(a.id) < place.get(b.id)); };
  const earns = (A, p) => A.low ? (p.kills || 0) > 0 : A.stat(p) >= A.min;   // (Untouchable needs a kill to count)
  const leads = (A, p, among) => earns(A, p) && among.every(q => q === p || better(A, p, q));
  const give = (p, A) => { taken.add(A.id); out.get(p.id).push({ id: A.id, label: A.label, title: A.label, icon: A.icon, value: A.text(A.stat(p)) }); };
  podium.forEach((p, i) => {
    const A = ACCOLADES.find(A => !taken.has(A.id) && leads(A, p, ranked))
      || ACCOLADES.find(A => !taken.has(A.id) && leads(A, p, podium.slice(i)));
    if (A) give(p, A);
  });
  for (const p of podium) { const A = ACCOLADES.find(A => !taken.has(A.id) && leads(A, p, ranked)); if (A) give(p, A); }
  return out;
}
const DEBUG = !!process.env.MATCH_DEBUG;
const DIFFS = ['easy', 'normal', 'hard'];
const SPECTATE_AT = [0, 0, -38];
// map.js FFA_SPAWNS (4–8 points spread for fair duel openings) once the environment agent adds them; until then the
// existing spawn points.
const spawnList = () => C.FFA_SPAWNS?.length ? C.FFA_SPAWNS : C.SPAWN_POINTS;

export function createMatch(ctx) {
  const { players, props } = ctx;
  const S = {
    phase: 'countdown', phaseEnd: 0, paused: true,   // paused until a human is here
    target: null, cap: null, size: FFA.size,       // debug overrides
    times: { ...TIMES },
    results: null,
    botDiff: 'normal',                             // the most recent human's bot difficulty
    filling: false,                                // ctx.addBot is adding a fill bot right now
    fillCheckAt: 0, graceUntil: 0,
    matches: 0,                                    // finished matches (for the harness)
  };
  const t = () => ctx.now();
  const target = () => S.target ?? FFA.target;
  const humans = () => [...players.values()].filter(p => !p.bot);
  const fighters = () => [...players.values()].filter(p => !p.spectator);
  const pub = (p) => ({ id: p.id, name: p.name, bot: !!p.bot, loadout: p.loadout,
    kills: p.kills, deaths: p.deaths, dmg: Math.round(p.mDmg || 0) });

  // ------------------------------------------------------------ seats and bot fill
  // Up to S.size fighters. Humans outrank bots: a human arriving at a full match takes a bot's place; with no bot
  // to replace, they spectate until a place opens (the earliest spectator first).
  function seat(p) {
    p.spectator = false; p.watchOnly = false;
    p.team = null;
  }
  function spectate(p) {
    p.spectator = true;
    p.team = null;
    p.dead = false;
    p.p = SPECTATE_AT.slice();
  }
  function fillBots() {
    if (!humans().length) return;
    // humans waiting while bots hold places: a bot leaves, the earliest spectator sits down
    for (const h of humans().filter(p => p.spectator && !p.watchOnly && !p.idle).sort((a, b) => a.id - b.id)) {
      if (fighters().length >= S.size) {
        const bots = fighters().filter(p => p.bot).sort((a, b) => (b.fill ? 1 : 0) - (a.fill ? 1 : 0) || b.id - a.id);
        if (!bots.length) break;
        ctx.removePlayer(bots[0].id);
      }
      seat(h);
      ctx.respawn(h);
      ctx.send(h.id, { t: 'notice', text: 'A place opened: you are in the match.' });
    }
    // too many fighters (a smaller debug size): bots leave first
    while (fighters().length > S.size) {
      const bots = fighters().filter(p => p.bot).sort((a, b) => (b.fill ? 1 : 0) - (a.fill ? 1 : 0) || b.id - a.id);
      if (!bots.length) break;
      ctx.removePlayer(bots[0].id);
    }
    // top up to S.size with bots at the humans' difficulty
    let guard = S.size;
    while (fighters().length < S.size && guard-- > 0) {
      const before = players.size;
      S.filling = true;
      try { ctx.addBot(S.botDiff); } finally { S.filling = false; }
      if (players.size === before) break;
    }
  }

  // ------------------------------------------------------------ phases
  function setPhase(phase, dur) {
    S.phase = phase;
    S.phaseEnd = t() + dur;
    ctx.broadcast({ t: 'matchPhase', match: matchPublic() });
  }
  function clearStats() {
    for (const p of players.values()) { p.kills = 0; p.deaths = 0; p.mDmg = 0; p.ms = freshStats(); p.assistBy = new Map(); }
  }
  function resetUlt(p) { if (ctx.resetUlt) ctx.resetUlt(p); else ctx.addUltCharge(p, -1000); }
  // Between matches: everyone respawns, props back where they started, rams gone, ultimate charge 0.
  function resetArena() {
    for (const pr of props.values()) {
      if (pr.state === 'thrown') continue;   // in flight: it shatters where it lands and respawns as usual
      const carrier = pr.carrier && players.get(pr.carrier);
      if (carrier && carrier.carrying === pr.id) carrier.carrying = null;
      const sp = C.PROP_SPAWNS[pr.id - 1];
      if (sp) { pr.x = sp[1]; pr.z = sp[2]; pr.y = 0; }   // (props spawn on the ground)
      pr.state = 'idle'; pr.carrier = null; pr.respawnAt = 0; pr.trap = null;
      ctx.broadcast({ t: 'prop', prop: ctx.propPublic(pr) });
    }
    ctx.resetRams?.();
    for (const p of players.values()) { resetUlt(p); if (!p.spectator) ctx.respawn(p); }
    clearStats();
  }
  function startCountdown() {
    S.results = null; S.recap = null;
    resetArena();
    setPhase('countdown', S.times.countdown);
  }
  function startLive() {
    S.liveAt = t();
    clearStats();
    for (const p of players.values()) resetUlt(p);
    setPhase('live', S.cap ?? FFA.cap);
  }
  function mvpScore(p) { return (p.kills || 0) * 100 + (p.mDmg || 0) - (p.deaths || 0) * 30; }
  function endMatch(reason) {
    const list = fighters();
    const best = [...list].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const winner = best[0] && (!best[1] || best[0].kills > best[1].kills) ? best[0].id : null;
    const mvp = [...list].sort((a, b) => mvpScore(b) - mvpScore(a))[0];
    S.results = {
      mode: 'ffa', reason, winner, mvp: mvp ? mvp.id : null, target: target(),
      players: list.map(pub).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.dmg - a.dmg),
    };
    S.matches++;
    console.log(`[match] over (${reason}): winner ${players.get(winner)?.name ?? 'none (a tie)'}, mvp ${mvp?.name}`);
    ctx.broadcast({ t: 'matchEnd', results: S.results });
    S.recap = recapOf(list);   // (built now: the gap shouldn't change who placed where)
    // round 18: every fighter in place order and the live time, once per match (server.js records it to the saves)
    try { ctx.onMatchEnd?.([...list].sort(byPlace), { seconds: Math.round(t() - (S.liveAt ?? t())) }); } catch (e) { console.warn('[match] onMatchEnd', e); }
    setPhase('end', S.times.end);
  }
  // Round 16 (Ty): after the gap, 10 s of recap: the top three on a podium with their accolades, a row for the rest
  function recapOf(list) {
    const ranked = [...list].sort(byPlace), acc = pickAccolades(ranked);
    const row = (p, i) => ({ id: p.id, name: p.name, bot: !!p.bot, place: i + 1, kills: p.kills || 0, deaths: p.deaths || 0, damage: Math.round(p.mDmg || 0) });
    const podium = ranked.slice(0, 3).map((p, i) => ({ ...row(p, i), body: p.body || 'mage', color: p.color, loadout: p.loadout,
        colors: Object.fromEntries(C.LOADOUT_SLOTS.map(s => [s, C.spellInfo(p.loadout?.[s])?.color ?? null])), element: C.dominantElement?.(p.loadout) ?? null,
        accolades: acc.get(p.id) }));
    const everyone = ranked.slice(3).map((p, i) => row(p, i + 3));
    return { t: 'recap', duration: S.times.recap, podium, everyone, top: podium, rest: everyone };   // (top, rest: the names podium.js reads)
  }
  function startRecap() {
    setPhase('recap', S.times.recap);
    if (S.recap) ctx.broadcast({ ...S.recap, duration: S.times.recap });
  }
  function checkWin() {
    if (S.phase === 'live' && fighters().some(p => p.kills >= target())) endMatch('target');
  }

  function matchPublic() {
    return {
      mode: 'ffa', name: FFA.name, phase: S.phase, left: S.paused ? null : Math.max(0, +(S.phaseEnd - t()).toFixed(1)),
      target: target(), size: S.size,
      leader: S.phase === 'live' || S.phase === 'end' || S.phase === 'recap' ? leader() : null,
    };
  }
  // The current leader: { id, kills } (null when nobody has a kill, or two share the lead).
  function leader() {
    const best = fighters().sort((a, b) => b.kills - a.kills);
    if (!best[0] || !best[0].kills || (best[1] && best[1].kills === best[0].kills)) return null;
    return { id: best[0].id, kills: best[0].kills };
  }

  // Round 14 (pacing: the farthest spawn put you 37 m from anyone, 11 s from your first hit): among the spawns
  // C.SPAWN_CHOICE.min–max m from the nearest living enemy, the farthest; with none in that band, the 2nd-farthest
  // overall (the farthest when there's only one). A little randomness so equal spots alternate.
  function nearestEnemyAt(p, sp) {
    let d = Infinity;
    for (const q of players.values()) {
      if (q === p || q.dead || q.spectator) continue;
      d = Math.min(d, Math.hypot(q.p[0] - sp[0], q.p[2] - sp[2]));
    }
    return d === Infinity ? 1000 : d;
  }
  function chooseSpawn(p) {
    const { min, max } = C.SPAWN_CHOICE;
    const ranked = spawnList().map(sp => ({ sp, d: nearestEnemyAt(p, sp) }))
      .map(r => ({ ...r, key: r.d + Math.random() * 2 })).sort((a, b) => b.key - a.key);
    if (ranked[0].d >= 1000) return ranked[Math.floor(Math.random() * ranked.length)].sp;   // nobody else alive
    const band = ranked.find(r => r.d >= min && r.d <= max);
    return (band || ranked[Math.min(1, ranked.length - 1)]).sp;
  }

  return {
    // exposed for the test harness
    state: () => S, ffa: FFA, matchPublic, spawnList, leader,

    isEnemy(a, b) {
      if (!a || !b || a.id === b.id || a.spectator || b.spectator) return false;
      return S.phase !== 'end' && S.phase !== 'recap';   // the gap and the recap: no fighting
    },
    spawnPointFor(p) {
      if (p.spectator) return SPECTATE_AT.slice();
      return chooseSpawn(p);
    },
    onJoin(p) {
      p.kills = 0; p.deaths = 0; p.mDmg = 0; p.ms = freshStats(); p.assistBy = new Map();
      p.team = null;
      if (p.bot) {
        p.fill = S.filling;
        if (!S.filling && DIFFS.includes(p.bot.difficulty)) S.botDiff = p.bot.difficulty;   // a human asked for this one
        // a bot someone asked for while the match is full: no room (a human's place is never given to a bot)
        if (fighters().filter(q => q !== p).length >= S.size) {
          const fill = fighters().filter(q => q !== p && q.bot && q.fill).sort((a, b) => b.id - a.id)[0];
          if (!S.filling && fill) ctx.removePlayer(fill.id);   // an asked-for bot replaces a fill bot
          else { ctx.removePlayer(p.id); return; }
        }
        seat(p);
        return;
      }
      if (DIFFS.includes(p.botPref)) S.botDiff = p.botPref;
      S.graceUntil = t() + 1.5;   // give the join screen's own addBot requests a moment before filling
      if (S.paused) { S.paused = false; S.startOnTick = true; }
      // a full match: take a bot's place, else spectate
      if (fighters().filter(q => q !== p).length >= S.size) {
        const bots = fighters().filter(q => q.bot).sort((a, b) => (b.fill ? 1 : 0) - (a.fill ? 1 : 0) || b.id - a.id);
        if (bots.length) ctx.removePlayer(bots[0].id);
        else {
          spectate(p);
          ctx.send(p.id, { t: 'notice', text: `The match is full (${S.size} wizards): you are watching until a place opens.` });
          return;
        }
      }
      seat(p);
    },
    // Idle players (server.js tracks input): an idle fighter watches instead and a bot takes the place; back from idle, the
    // spectator queue above seats them again when there's room (a fill bot makes way).
    setIdle(p, idle) {
      if (p.bot || !!p.idle === idle) return;
      p.idle = idle;
      if (idle && !p.spectator) spectate(p);
      S.fillCheckAt = 0;
      ctx.send(p.id, { t: 'idle', on: idle });
    },
    onLeave(p) {
      // last human gone: server.js clears the bots; wait for the next arrival
      if (!p.bot && !humans().some(q => q !== p)) { S.paused = true; S.phase = 'countdown'; S.results = null; S.recap = null; }
      else S.fillCheckAt = 0;   // a place may have opened for a spectator
    },
    // (the stats count in the live phase only; damage past what the target had left doesn't count)
    onDamage(target, attacker, dmg, from = null) {
      if (S.phase !== 'live') return;
      const real = Math.min(dmg, Math.max(0, target.hp + dmg));
      (target.ms ??= freshStats()).dmgTaken += real;
      if (!attacker || attacker === target) return;
      attacker.mDmg = (attacker.mDmg || 0) + real;
      const ms = (attacker.ms ??= freshStats());
      ms.biggest = Math.max(ms.biggest, dmg);
      if (from) ms.longest = Math.max(ms.longest, Math.hypot(target.p[0] - from[0], target.p[2] - from[2]));
      (target.assistBy ??= new Map()).set(attacker.id, t());
    },
    onKill(target, attacker) {
      if (S.phase !== 'live') return;
      for (const [id, at] of target.assistBy || []) {
        const q = players.get(id);
        if (q && q !== attacker && q !== target && t() - at <= ASSIST_WINDOW) (q.ms ??= freshStats()).assists++;
      }
      target.assistBy = new Map();
      checkWin();
    },
    onHeal(p, amount) { if (S.phase === 'live' && amount > 0) (p.ms ??= freshStats()).healed += amount; },
    onPotion(p) { if (S.phase === 'live') (p.ms ??= freshStats()).potions++; },
    onAirJump(p) { if (S.phase === 'live') (p.ms ??= freshStats()).airJumps++; },
    onTrap(curser) { if (S.phase === 'live' && curser) (curser.ms ??= freshStats()).traps++; },
    onPickup() {},
    onDrop() {},
    onPropBroken() {},
    canThrow() { return true; },

    tick() {
      const now = t();
      if (S.paused) return;
      if (S.startOnTick) { S.startOnTick = false; startCountdown(); }
      if (now >= S.fillCheckAt && now >= S.graceUntil) { S.fillCheckAt = now + 1; fillBots(); }
      for (const p of players.values()) {   // debug: pinned bots stay put
        if (!p.pin || p.dead) continue;
        p.p = [p.pin.x, 0, p.pin.z];
        p.rootUntil = p.silenceUntil = now + 0.5;
      }
      if (S.phase === 'live') {
        checkWin();
        if (S.phase === 'live' && now >= S.phaseEnd) endMatch('time');
      } else if (now >= S.phaseEnd) {
        if (S.phase === 'countdown') startLive();
        else if (S.phase === 'end') startRecap();
        else if (S.phase === 'recap') startCountdown();   // the rematch: no vote
      }
    },
    handle(p, msg) {
      if (msg.t === 'matchDebug') {
        if (!DEBUG) return true;
        const num = (v, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;
        if (msg.target !== undefined) S.target = num(msg.target, 1, 10000) ?? null;
        if (msg.cap !== undefined) S.cap = num(msg.cap, 5, 3600) ?? null;
        { const cd = msg.countdown ?? msg.warmup;   // (`warmup`: the old name, still taken)
          if (cd !== undefined) S.times.countdown = num(cd, 1, 60) ?? TIMES.countdown; }
        if (msg.endTime !== undefined) S.times.end = num(msg.endTime, 0.2, 60) ?? TIMES.end;
        if (msg.recapTime !== undefined) S.times.recap = num(msg.recapTime, 0.2, 60) ?? TIMES.recap;
        if (msg.size !== undefined) { S.size = Math.round(num(msg.size, 1, 16) ?? FFA.size); S.fillCheckAt = 0; }
        // pinBots: every bot frozen where it stands (rooted and silenced), for UI tests; false lets them go
        if (msg.pinBots !== undefined) for (const q of players.values()) if (q.bot) q.pin = msg.pinBots ? { x: q.p[0], z: q.p[2] } : null;
        if (DIFFS.includes(msg.botDiff)) S.botDiff = msg.botDiff;
        if (msg.spectate) { p.watchOnly = true; spectate(p); S.fillCheckAt = 0; }   // a test observer: never seated
        if (msg.skip) {
          if (S.phase === 'live') endMatch('skip');
          else S.phaseEnd = t();
        }
        return true;
      }
      if (msg.t === 'matchStats') {
        ctx.send(p.id, { t: 'matchStats', match: matchPublic(), players: fighters().map(q => ({ ...pub(q), stats: { ...freshStats(), ...q.ms } })), matches: S.matches });
        return true;
      }
      return false;
    },
    // round 17: a private room's host picks the fill bots' difficulty (room.js swaps the bots' brains)
    setBotDiff(d) { if (DIFFS.includes(d)) S.botDiff = d; },
    playerExtras(p) {
      return { dmg: Math.round(p.mDmg || 0), spectator: p.spectator || undefined };
    },
    snapshotExtras() { return { match: matchPublic() }; },
    welcomeExtras() { return { match: matchPublic(), results: S.phase === 'end' || S.phase === 'recap' ? S.results : null, recap: S.phase === 'recap' ? S.recap : null }; },
  };
}
