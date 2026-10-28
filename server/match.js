// Match and game modes: FFA / Team Deathmatch 3v3 / Sacred Relic 3v3, teams, scoring, the relic, the
// end-of-match vote and bot fill. Modes agent (round 5); see docs/agents/modes.md.
//
// Hooks: server.js calls these. Keep the names and signatures; fill in the bodies.
//   isEnemy(a, b)            players: may a hurt b? (no friendly fire in team modes; FFA: anyone but yourself)
//   spawnPointFor(p)         [x, 0, z] or null for the default random spawn
//   onJoin(p) / onLeave(p)   a human or bot entered or left
//   onDamage(target, attacker, dmg)   attacker may be undefined (goats, environment)
//   onKill(target, attacker, cause)
//   onPickup(p, prop)        a prop started rising toward p (telekinesis)
//   onDrop(p, prop, reason)  'dropped' | 'released' | 'destroyed' | 'thrown'
//   onPropBroken(prop)
//   canThrow(p, prop)        false: the server turns the throw into a gentle drop (the relic)
//   tick(dt)                 every simulation step
//   handle(p, msg)           messages server.js doesn't know (e.g. { t: 'vote', mode })
//   playerExtras(p)          merged into playerPublic (e.g. { team })
//   snapshotExtras()         merged into every 'snap' broadcast (e.g. { match: {...} })
//   welcomeExtras(p)         merged into the 'welcome' message
//
// ctx (from server.js): { players, props, now, broadcast, send, addBot, removePlayer, respawn,
//   propPublic, addUltCharge(p, pct) }, plus optional resetGoats() and resetUlt(p) if server.js offers them.
//
// Loop: warmup (10 s, nothing scores) → live (to the target or the 8 min cap) → end (results) → vote (15 s)
// → reset (everyone respawns on their side, props and goats reset, ultimate charge 0) → warmup ...
// Debug (only with MATCH_DEBUG=1 in the server's environment): { t: 'matchDebug', target, cap, warmup,
// endTime, voteTime, rotate, botDiff, mode, skip: true, spectate: true }.

import * as C from '../public/shared/constants.js';

export const MODES = {
  ffa:   { name: 'Free-for-all',    teams: false, target: 15,  cap: 480 },
  tdm:   { name: 'Team Deathmatch', teams: true,  target: 30,  cap: 480 },
  relic: { name: 'Sacred Relic',    teams: true,  target: 300, cap: 480 },
};
export const TEAMS = {
  ember: { name: 'Ember', color: 0xff6a2a },
  frost: { name: 'Frost', color: 0x3aa8ff },
};
const TEAM_IDS = ['ember', 'frost'];
const TEAM_SIZE = 3;
const RELIC = { rotate: 30, points: 5, ult: 2, types: new Set(['crate', 'barrel', 'pot', 'hay', 'potion']) };
const TIMES = { warmup: 10, end: 8, vote: 15 };
// Ember north (house side), Frost south (meadow side). map.js may provide TEAM_SPAWNS (requested); until then
// these are the existing spawn points on each side.
const TEAM_SPAWNS = C.TEAM_SPAWNS || {
  ember: [[8, 0, 4], [-9, 0, 8], [4, 0, 14], [-5, 0, 14.5]],
  frost: [[6, 0, -19], [-6, 0, -20], [14, 0, -22], [-14, 0, -22], [-3.5, 0, -30]],
};
const DEBUG = !!process.env.MATCH_DEBUG;
const DIFFS = ['easy', 'normal', 'hard'];

export function createMatch(ctx) {
  const { players, props } = ctx;
  const S = {
    mode: process.env.MATCH_MODE && MODES[process.env.MATCH_MODE] ? process.env.MATCH_MODE : 'ffa',
    phase: 'warmup', phaseEnd: 0, paused: true,   // paused until a human is here
    target: null, cap: null,                       // debug overrides of the mode's numbers
    times: { ...TIMES }, rotate: RELIC.rotate,
    scores: { ember: 0, frost: 0 },
    relic: null,                                   // { propId, rotateAt, restore }
    votes: new Map(),                              // human id -> mode
    results: null,
    botDiff: 'normal',                             // the most recent human's bot difficulty
    filling: null,                                 // team for the bot ctx.addBot is adding right now
    fillCheckAt: 0, graceUntil: 0,
    stats: { ff: 0, relicEvents: [] },             // for the test harness
  };
  const t = () => ctx.now();
  const M = () => MODES[S.mode];
  const target = () => S.target ?? M().target;
  const humans = () => [...players.values()].filter(p => !p.bot);
  const fighters = () => [...players.values()].filter(p => !p.spectator);
  const inTeam = (team) => fighters().filter(p => p.team === team);
  const pub = (p) => ({ id: p.id, name: p.name, team: p.team || null, bot: !!p.bot, wizard: p.wizard,
    kills: p.kills, deaths: p.deaths, dmg: Math.round(p.mDmg || 0), pts: Math.floor(p.mPts || 0) });

  function relicEvent(type, extra = {}) {
    const e = { type, at: +t().toFixed(2), ...extra };
    S.stats.relicEvents.push(e);
    if (S.stats.relicEvents.length > 200) S.stats.relicEvents.shift();
    ctx.broadcast({ t: 'matchRelic', ...e, relic: relicPublic() });
  }

  // ------------------------------------------------------------ teams and bot fill
  function smallerTeam() {
    const count = (team) => inTeam(team).length, h = (team) => inTeam(team).filter(p => !p.bot).length;
    const [a, b] = TEAM_IDS;
    if (h(a) !== h(b)) return h(a) < h(b) ? a : b;
    if (count(a) !== count(b)) return count(a) < count(b) ? a : b;
    return Math.random() < 0.5 ? a : b;
  }
  function assignTeam(p) {
    if (!M().teams || p.spectator) { p.team = null; return; }
    p.team = S.filling || (p.bot ? smallerTeamAll() : smallerTeam());
  }
  // A bot a human asked for goes where there are fewest players (fill trims the surplus later)
  function smallerTeamAll() {
    const [a, b] = TEAM_IDS;
    const na = inTeam(a).length, nb = inTeam(b).length;
    return na === nb ? (Math.random() < 0.5 ? a : b) : na < nb ? a : b;
  }
  // Humans split evenly between the teams (a mode change), bots take what's left
  function balanceTeams() {
    if (!M().teams) { for (const p of players.values()) p.team = null; return; }
    const hs = humans().filter(p => !p.spectator).sort(() => Math.random() - 0.5);
    const first = Math.random() < 0.5 ? 0 : 1;
    hs.forEach((p, i) => { p.team = TEAM_IDS[(i + first) % 2]; });
    for (const p of players.values()) if (p.bot) p.team = null;
    for (const p of players.values()) if (p.bot) p.team = smallerTeamAll();
  }
  // Team modes: 3v3 (or bigger if there are more humans), topped up with bots, surplus bots leave.
  function fillBots() {
    if (!humans().length) return;
    if (!M().teams) {
      // FFA keeps today's practice bots: the fill bots go, the ones people asked for stay
      for (const p of [...players.values()]) if (p.bot && p.fill) ctx.removePlayer(p.id);
      return;
    }
    const hs = humans().filter(p => !p.spectator).length;
    const size = Math.max(TEAM_SIZE, Math.ceil(hs / 2));
    for (const team of TEAM_IDS) {
      let members = inTeam(team);
      while (members.length > size) {
        const bots = members.filter(p => p.bot);
        if (!bots.length) break;
        // prefer dropping a bot on the old difficulty, then a fill bot, then the newest
        bots.sort((a, b) => (a.bot.difficulty === S.botDiff) - (b.bot.difficulty === S.botDiff) || (b.fill ? 1 : 0) - (a.fill ? 1 : 0) || b.id - a.id);
        ctx.removePlayer(bots[0].id);
        members = inTeam(team);
      }
      while (members.length < size) {
        S.filling = team;
        try { ctx.addBot(S.botDiff); } finally { S.filling = null; }
        const added = inTeam(team).length;
        if (added === members.length) break;
        members = inTeam(team);
      }
    }
  }

  // ------------------------------------------------------------ the relic
  const relicProp = () => S.relic && props.get(S.relic.propId);
  function relicHolder() {
    const prop = relicProp();
    if (!prop || prop.state !== 'carried') return null;
    const p = players.get(prop.carrier);
    return p && !p.dead && p.carrying === prop.id ? p : null;
  }
  function relicPublic() {
    if (!S.relic) return null;
    const prop = relicProp(), h = relicHolder();
    return { propId: S.relic.propId, holder: h ? h.id : null, team: h ? h.team : null,
      left: Math.max(0, +(S.relic.rotateAt - t()).toFixed(1)), x: prop ? +prop.x.toFixed(2) : 0, z: prop ? +prop.z.toFixed(2) : 0 };
  }
  // A new relic: a random idle eligible prop (not the current one), or null if there's none right now.
  function pickRelic(reason) {
    const prev = S.relic?.propId;
    const pool = [...props.values()].filter(pr => pr.state === 'idle' && RELIC.types.has(pr.type) && pr.id !== prev && !pr.cursedBy);
    const pr = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    S.relic = { propId: pr ? pr.id : null, rotateAt: t() + S.rotate, restore: null };
    relicEvent(reason, { prop: S.relic.propId, prev });
  }
  // Positions of the relic while it's carried (server.js keeps x/z at the spot it was lifted from)
  function relicPos(prop) {
    const c = prop.carrier && players.get(prop.carrier);
    if (c && (prop.state === 'carried' || prop.state === 'lifting')) { const hp = C.holdPoint(c.p, c.yaw); return [hp[0], hp[2]]; }
    return [prop.x, prop.z];
  }
  function relicTick(dt) {
    const now = t();
    if (S.relic?.restore) {
      // a hit knocked the relic away: server.js shattered it; put it back down where it was, still the relic
      const prop = relicProp(), r = S.relic.restore;
      if (prop && prop.state === 'broken') {
        prop.state = 'idle'; prop.carrier = null; prop.respawnAt = 0;
        prop.x = Math.max(-C.ARENA_RADIUS, Math.min(C.ARENA_RADIUS, r[0])); prop.z = Math.max(-C.ARENA_RADIUS, Math.min(C.ARENA_RADIUS, r[1]));
        ctx.broadcast({ t: 'prop', prop: ctx.propPublic(prop) });
      }
      S.relic.restore = null;
    }
    if (!S.relic || S.relic.propId == null || !relicProp() || now >= S.relic.rotateAt) { pickRelic(S.relic?.propId == null ? 'spawn' : 'rotate'); return; }
    const h = relicHolder();
    if (h && h.team) {
      const pts = RELIC.points * dt;
      S.scores[h.team] += pts;
      h.mPts = (h.mPts || 0) + pts;
      ctx.addUltCharge(h, RELIC.ult * dt);
    }
  }

  // ------------------------------------------------------------ phases
  function setPhase(phase, dur) {
    S.phase = phase;
    S.phaseEnd = t() + dur;
    ctx.broadcast({ t: 'matchPhase', match: matchPublic() });
  }
  function clearStats() {
    for (const p of players.values()) { p.kills = 0; p.deaths = 0; p.mDmg = 0; p.mPts = 0; }
    S.scores = { ember: 0, frost: 0 };
  }
  function resetUlt(p) { if (ctx.resetUlt) ctx.resetUlt(p); else ctx.addUltCharge(p, -1000); }
  // Between matches: everyone back to their side, props back where they started, goats home, charge 0.
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
    ctx.resetGoats?.();
    for (const p of players.values()) { resetUlt(p); if (!p.spectator) ctx.respawn(p); }
    clearStats();
    S.relic = null;
  }
  function startWarmup() {
    S.votes.clear(); S.results = null; S.relic = null;
    resetArena();
    setPhase('warmup', S.times.warmup);
  }
  function startLive() {
    clearStats();
    for (const p of players.values()) resetUlt(p);
    S.relic = null;
    if (S.mode === 'relic') pickRelic('spawn');
    setPhase('live', S.cap ?? M().cap);
  }
  function mvpScore(p) { return (p.kills || 0) * 100 + (p.mDmg || 0) + (p.mPts || 0) * 4 - (p.deaths || 0) * 30; }
  function endMatch(reason) {
    const list = fighters();
    let winner = null;
    if (M().teams) {
      const e = Math.floor(S.scores.ember), f = Math.floor(S.scores.frost);
      winner = e === f ? null : e > f ? 'ember' : 'frost';
    } else {
      const best = [...list].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      winner = best[0] && (!best[1] || best[0].kills > best[1].kills) ? best[0].id : null;
    }
    const mvp = [...list].sort((a, b) => mvpScore(b) - mvpScore(a))[0];
    S.results = {
      mode: S.mode, reason, winner, mvp: mvp ? mvp.id : null,
      scores: M().teams ? { ember: Math.floor(S.scores.ember), frost: Math.floor(S.scores.frost) } : null,
      players: list.map(pub).sort((a, b) => b.kills - a.kills || b.pts - a.pts || a.deaths - b.deaths),
      ff: S.stats.ff,
    };
    S.relic = null;
    console.log(`[match] ${S.mode} over (${reason}): winner ${winner}, mvp ${mvp?.name}`);
    ctx.broadcast({ t: 'matchEnd', results: S.results });
    setPhase('end', S.times.end);
  }
  function startVote() { S.votes.clear(); setPhase('vote', S.times.vote); }
  function tallyVotes() {
    const n = { ffa: 0, tdm: 0, relic: 0 };
    for (const m of S.votes.values()) if (n[m] !== undefined) n[m]++;
    return n;
  }
  function finishVote() {
    const n = tallyVotes();
    const top = Math.max(...Object.values(n));
    const leaders = Object.keys(n).filter(k => n[k] === top);
    const next = top > 0 && leaders.length === 1 ? leaders[0] : S.mode;
    setMode(next);
    startWarmup();
  }
  function setMode(mode) {
    if (!MODES[mode]) return;
    const changed = mode !== S.mode;
    S.mode = mode;
    if (changed || M().teams) balanceTeams();
    fillBots();
    ctx.broadcast({ t: 'matchMode', mode, votes: tallyVotes() });
  }
  function checkWin() {
    if (S.phase !== 'live') return;
    const goal = target();
    if (M().teams) { if (S.scores.ember >= goal || S.scores.frost >= goal) endMatch('target'); }
    else if (fighters().some(p => p.kills >= goal)) endMatch('target');
  }

  function matchPublic() {
    const now = t();
    return {
      mode: S.mode, phase: S.phase, left: S.paused ? null : Math.max(0, +(S.phaseEnd - now).toFixed(1)),
      target: target(), teams: M().teams,
      scores: { ember: Math.floor(S.scores.ember), frost: Math.floor(S.scores.frost) },
      relic: S.mode === 'relic' && S.phase === 'live' ? relicPublic() : null,
      votes: S.phase === 'vote' ? tallyVotes() : null,
    };
  }

  return {
    // exposed for objectives.js and the test harness
    state: () => S, modes: MODES, teams: TEAMS, relicHolder, relicProp, matchPublic,

    isEnemy(a, b) {
      if (!a || !b || a.id === b.id || a.spectator || b.spectator) return false;
      if (S.phase === 'end' || S.phase === 'vote') return false;   // intermission: no fighting
      if (!M().teams) return true;
      return !a.team || !b.team || a.team !== b.team;
    },
    spawnPointFor(p) {
      if (p.spectator) return [0, 0, -38];
      if (!M().teams || !p.team) return null;
      const list = TEAM_SPAWNS[p.team];
      // the spawn farthest from any living enemy
      let best = null, bd = -1;
      for (const sp of list) {
        let d = Infinity;
        for (const q of players.values()) if (!q.dead && q.team && q.team !== p.team && q !== p) d = Math.min(d, Math.hypot(q.p[0] - sp[0], q.p[2] - sp[2]));
        d += Math.random() * 3;
        if (d > bd) { bd = d; best = sp; }
      }
      return best;
    },
    onJoin(p) {
      p.kills = 0; p.deaths = 0; p.mDmg = 0; p.mPts = 0;
      if (p.bot) {
        p.fill = !!S.filling;
        if (!S.filling && DIFFS.includes(p.bot.difficulty)) S.botDiff = p.bot.difficulty;   // a human asked for this one
      } else {
        if (DIFFS.includes(p.botPref)) S.botDiff = p.botPref;
        S.graceUntil = t() + 1.5;   // give the join screen's own addBot requests a moment before filling
        if (S.paused) { S.paused = false; S.setPhaseOnTick = true; }
      }
      assignTeam(p);
    },
    onLeave(p) {
      S.votes.delete(p.id);
      // last human gone: server.js clears the bots; wait for the next arrival
      if (!p.bot && !humans().some(q => q !== p)) { S.paused = true; S.phase = 'warmup'; S.relic = null; S.results = null; }
    },
    onDamage(target, attacker, dmg) {
      if (!attacker || attacker === target) return;
      if (M().teams && attacker.team && attacker.team === target.team) S.stats.ff++;
      if (S.phase === 'live') attacker.mDmg = (attacker.mDmg || 0) + dmg;
    },
    onKill(target, attacker) {
      if (S.phase !== 'live') return;
      if (S.mode === 'tdm' && attacker && attacker !== target && attacker.team && attacker.team !== target.team) {
        S.scores[attacker.team]++;
      }
      checkWin();
    },
    onPickup(p, prop) {
      if (S.relic && prop.id === S.relic.propId) relicEvent('lift', { by: p.id, team: p.team });
    },
    onDrop(p, prop, reason) {
      if (!S.relic || prop.id !== S.relic.propId) return;
      if (reason === 'destroyed') {
        // the holder died: a new relic, and the clock starts over
        relicEvent('holderDied', { by: p.id, team: p.team });
        pickRelic('reset');
      } else relicEvent('drop', { by: p.id, reason });
    },
    onPropBroken(prop) {
      if (!S.relic || prop.id !== S.relic.propId || S.phase !== 'live') return;
      // knocked out of a holder's grip, or hit where it stood: it stays the relic, set down where it was
      const by = prop.carrier;
      S.relic.restore = relicPos(prop);
      relicEvent(by ? 'knocked' : 'hit', { by });
    },
    canThrow(p, prop) { return !(S.relic && prop.id === S.relic.propId && S.phase === 'live'); },

    tick(dt) {
      const now = t();
      if (S.paused) return;
      if (S.setPhaseOnTick) { S.setPhaseOnTick = false; balanceTeams(); startWarmup(); }
      if (now >= S.fillCheckAt && now >= S.graceUntil) { S.fillCheckAt = now + 1; fillBots(); }
      if (S.phase === 'live') {
        if (S.mode === 'relic') relicTick(dt);
        checkWin();
        if (S.phase === 'live' && now >= S.phaseEnd) endMatch('time');
      } else if (now >= S.phaseEnd) {
        if (S.phase === 'warmup') startLive();
        else if (S.phase === 'end') startVote();
        else if (S.phase === 'vote') finishVote();
      }
    },
    handle(p, msg) {
      if (msg.t === 'vote') {
        if (S.phase !== 'vote' || p.bot || !MODES[msg.mode]) return true;
        S.votes.set(p.id, msg.mode);
        ctx.broadcast({ t: 'matchVotes', votes: tallyVotes(), voter: p.id, mode: msg.mode });
        return true;
      }
      if (msg.t === 'matchDebug') {
        if (!DEBUG) return true;
        const num = (v, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;
        if (msg.target !== undefined) S.target = num(msg.target, 1, 10000) ?? null;
        if (msg.cap !== undefined) S.cap = num(msg.cap, 5, 3600) ?? null;
        if (msg.warmup !== undefined) S.times.warmup = num(msg.warmup, 1, 60) ?? TIMES.warmup;
        if (msg.endTime !== undefined) S.times.end = num(msg.endTime, 1, 60) ?? TIMES.end;
        if (msg.voteTime !== undefined) S.times.vote = num(msg.voteTime, 1, 60) ?? TIMES.vote;
        if (msg.rotate !== undefined) S.rotate = num(msg.rotate, 3, 120) ?? RELIC.rotate;
        if (DIFFS.includes(msg.botDiff)) S.botDiff = msg.botDiff;
        if (msg.spectate) {
          p.spectator = true; p.team = null;
          ctx.respawn(p);
        }
        if (msg.mode && MODES[msg.mode]) { setMode(msg.mode); startWarmup(); }
        if (msg.skip) {
          if (S.phase === 'live') endMatch('skip');
          else S.phaseEnd = now();
        }
        return true;
      }
      if (msg.t === 'matchStats') {
        ctx.send(p.id, { t: 'matchStats', stats: S.stats, match: matchPublic(), players: fighters().map(pub),
          relicProp: relicProp() ? ctx.propPublic(relicProp()) : null });
        return true;
      }
      return false;
    },
    playerExtras(p) {
      const team = M().teams ? p.team || null : null;
      return { team, teamColor: team ? TEAMS[team].color : null, dmg: Math.round(p.mDmg || 0), pts: Math.floor(p.mPts || 0), spectator: p.spectator || undefined };
    },
    snapshotExtras() { return { match: matchPublic() }; },
    welcomeExtras() { return { match: matchPublic(), results: S.phase === 'end' || S.phase === 'vote' ? S.results : null, teams: TEAMS, modes: MODES }; },
  };
}
