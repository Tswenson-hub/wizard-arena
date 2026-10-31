// The match (round 11: one mode only). A 4-player free-for-all: humans first, bots fill up to 4, a 5th human
// watches as a spectator until a place opens. First to 15 kills, or the most kills at the 7-minute cap.
// Loop: warmup (10 s, nothing scores) → live → end (results, 8 s) → an immediate rematch (warmup ...).
// Spells agent (round 11; it was the modes agent's).
//
// Hooks: server.js calls these.
//   isEnemy(a, b)            players: may a hurt b? (anyone but yourself, outside the intermission)
//   spawnPointFor(p)         [x, 0, z, yaw]: an FFA spawn near the fight but not on it (C.SPAWN_CHOICE)
//   onJoin(p) / onLeave(p)   a human or bot entered or left (a bot with no room is removed again at once)
//   onDamage(target, attacker, dmg)   attacker may be undefined (the environment)
//   onKill(target, attacker, cause)
//   onPickup / onDrop / onPropBroken / canThrow   prop hooks (no rules use them now)
//   tick(dt)                 every simulation step
//   handle(p, msg)           messages server.js doesn't know (matchDebug, matchStats)
//   playerExtras(p)          merged into playerPublic ({ dmg, spectator })
//   snapshotExtras()         merged into every 'snap' broadcast ({ match })
//   welcomeExtras(p)         merged into the 'welcome' message
//
// ctx (from server.js): { players, props, now, broadcast, send, addBot, removePlayer, respawn, propPublic,
//   addUltCharge(p, pct) }, plus optional resetRams() and resetUlt(p).
// Debug (only with MATCH_DEBUG=1 in the server's environment): { t: 'matchDebug', target, cap, warmup, endTime,
// botDiff, skip: true, spectate: true, pinBots: true | false, size }.

import * as C from '../public/shared/constants.js';

export const FFA = { name: 'Free-for-all', size: 4, target: 15, cap: 420 };   // round 14 (pacing): 10 / 480
const TIMES = { warmup: 10, end: 8 };
const DEBUG = !!process.env.MATCH_DEBUG;
const DIFFS = ['easy', 'normal', 'hard'];
const SPECTATE_AT = [0, 0, -38];
// map.js FFA_SPAWNS (4–8 points spread for fair duel openings) once the environment agent adds them; until then the
// existing spawn points.
const spawnList = () => C.FFA_SPAWNS?.length ? C.FFA_SPAWNS : C.SPAWN_POINTS;

export function createMatch(ctx) {
  const { players, props } = ctx;
  const S = {
    phase: 'warmup', phaseEnd: 0, paused: true,   // paused until a human is here
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
    for (const h of humans().filter(p => p.spectator && !p.watchOnly).sort((a, b) => a.id - b.id)) {
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
    for (const p of players.values()) { p.kills = 0; p.deaths = 0; p.mDmg = 0; }
  }
  function resetUlt(p) { if (ctx.resetUlt) ctx.resetUlt(p); else ctx.addUltCharge(p, -1000); }
  // Between matches: everyone respawns, props back where they started, rams gone, ultimate charge 0.
  function resetArena() {
    for (const pr of props.values()) {
      if (pr.state === 'thrown') continue;   // in flight: it shatters where it lands and respawns as usual
      const carrier = pr.carrier && players.get(pr.carrier);
      if (carrier && carrier.carrying === pr.id) carrier.carrying = null;
      const sp = C.PROP_SPAWNS[pr.id - 1];
      if (sp) { pr.x = sp[1]; pr.z = sp[2]; }
      pr.state = 'idle'; pr.carrier = null; pr.respawnAt = 0; pr.trap = null;
      ctx.broadcast({ t: 'prop', prop: ctx.propPublic(pr) });
    }
    ctx.resetRams?.();
    for (const p of players.values()) { resetUlt(p); if (!p.spectator) ctx.respawn(p); }
    clearStats();
  }
  function startWarmup() {
    S.results = null;
    resetArena();
    setPhase('warmup', S.times.warmup);
  }
  function startLive() {
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
    setPhase('end', S.times.end);
  }
  function checkWin() {
    if (S.phase === 'live' && fighters().some(p => p.kills >= target())) endMatch('target');
  }

  function matchPublic() {
    return {
      mode: 'ffa', name: FFA.name, phase: S.phase, left: S.paused ? null : Math.max(0, +(S.phaseEnd - t()).toFixed(1)),
      target: target(), size: S.size,
      leader: S.phase === 'live' || S.phase === 'end' ? leader() : null,
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
      return S.phase !== 'end';   // the results screen: no fighting
    },
    spawnPointFor(p) {
      if (p.spectator) return SPECTATE_AT.slice();
      return chooseSpawn(p);
    },
    onJoin(p) {
      p.kills = 0; p.deaths = 0; p.mDmg = 0;
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
    onLeave(p) {
      // last human gone: server.js clears the bots; wait for the next arrival
      if (!p.bot && !humans().some(q => q !== p)) { S.paused = true; S.phase = 'warmup'; S.results = null; }
      else S.fillCheckAt = 0;   // a place may have opened for a spectator
    },
    onDamage(target, attacker, dmg) {
      if (!attacker || attacker === target) return;
      if (S.phase === 'live') attacker.mDmg = (attacker.mDmg || 0) + dmg;
    },
    onKill() {
      if (S.phase !== 'live') return;
      checkWin();
    },
    onPickup() {},
    onDrop() {},
    onPropBroken() {},
    canThrow() { return true; },

    tick() {
      const now = t();
      if (S.paused) return;
      if (S.startOnTick) { S.startOnTick = false; startWarmup(); }
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
        if (S.phase === 'warmup') startLive();
        else if (S.phase === 'end') startWarmup();   // the rematch: no vote
      }
    },
    handle(p, msg) {
      if (msg.t === 'matchDebug') {
        if (!DEBUG) return true;
        const num = (v, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;
        if (msg.target !== undefined) S.target = num(msg.target, 1, 10000) ?? null;
        if (msg.cap !== undefined) S.cap = num(msg.cap, 5, 3600) ?? null;
        if (msg.warmup !== undefined) S.times.warmup = num(msg.warmup, 1, 60) ?? TIMES.warmup;
        if (msg.endTime !== undefined) S.times.end = num(msg.endTime, 1, 60) ?? TIMES.end;
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
        ctx.send(p.id, { t: 'matchStats', match: matchPublic(), players: fighters().map(pub), matches: S.matches });
        return true;
      }
      return false;
    },
    playerExtras(p) {
      return { dmg: Math.round(p.mDmg || 0), spectator: p.spectator || undefined };
    },
    snapshotExtras() { return { match: matchPublic() }; },
    welcomeExtras() { return { match: matchPublic(), results: S.phase === 'end' ? S.results : null }; },
  };
}
