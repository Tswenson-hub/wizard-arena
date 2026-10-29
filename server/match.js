// Match and game modes: FFA / Team Deathmatch 3v3 / Altar Siege 3v3, teams, scoring, the siege zone, the
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
//   canThrow(p, prop)        false: the server turns the throw into a gentle drop (no mode uses it now)
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
// endTime, voteTime, hop, overtime, botDiff, mode, skip: true, spectate: true, dummy: { team, x, z } | false,
// pinBots: true | false }.

import * as C from '../public/shared/constants.js';

export const MODES = {
  ffa:   { name: 'Free-for-all',    teams: false, target: 15,  cap: 480 },
  tdm:   { name: 'Team Deathmatch', teams: true,  target: 30,  cap: 480 },
  siege: { name: 'Altar Siege',     teams: true,  target: 100, cap: 480 },
};
export const TEAMS = {
  ember: { name: 'Ember', color: 0xff6a2a },
  frost: { name: 'Frost', color: 0x3aa8ff },
};
const TEAM_IDS = ['ember', 'frost'];
const TEAM_SIZE = 3;
// Altar Siege: a 7 m circle hops every 60 s (altar → barn → silo → altar). One team alone inside fills its bar
// (1%/s, 1.5%/s with 2+ inside); both teams inside is contested. If the cap hits while contested: overtime until
// it isn't, at most 30 s more.
const SIEGE = { hop: 60, warn: 5, rate1: 1, rate2: 1.5, ult: 1, overtime: 30, maxY: 2.5 };
// map.js (environment agent) provides SIEGE_ZONES; until then, open ground by each landmark.
const ZONE_NAMES = ['Altar', 'Barn', 'Silo'];
const SIEGE_ZONES = (C.SIEGE_ZONES || [{ x: 0, z: -7.5 }, { x: 23, z: 16.5 }, { x: -21, z: -15 }]).map((zn, i) => {
  const [x, z, r] = Array.isArray(zn) ? zn : [zn.x, zn.z, zn.r];
  return { x, z, r: r || 7, name: (!Array.isArray(zn) && zn.name) || ZONE_NAMES[i] || `Zone ${i + 1}` };
});
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
    times: { ...TIMES }, hop: SIEGE.hop, overtimeMax: SIEGE.overtime,
    scores: { ember: 0, frost: 0 },
    zone: null,                                    // siege: { i, hopAt, warned, owner, contested, inside }
    overtime: null,                                // siege: { until } once the cap hit while contested
    votes: new Map(),                              // human id -> mode
    results: null,
    botDiff: 'normal',                             // the most recent human's bot difficulty
    filling: null,                                 // team for the bot ctx.addBot is adding right now
    fillCheckAt: 0, graceUntil: 0,
    stats: { ff: 0, siege: null },                 // for the test harness
  };
  const t = () => ctx.now();
  const M = () => MODES[S.mode];
  const target = () => S.target ?? M().target;
  const humans = () => [...players.values()].filter(p => !p.bot);
  const fighters = () => [...players.values()].filter(p => !p.spectator);
  const inTeam = (team) => fighters().filter(p => p.team === team && !p.dummy);   // a debug dummy doesn't take a slot
  const pub = (p) => ({ id: p.id, name: p.name, team: p.team || null, bot: !!p.bot, wizard: p.wizard,
    kills: p.kills, deaths: p.deaths, dmg: Math.round(p.mDmg || 0), pts: Math.floor(p.mPts || 0) });

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
    for (const p of players.values()) if (p.bot && !p.dummy) p.team = null;
    for (const p of players.values()) if (p.bot && !p.dummy) p.team = smallerTeamAll();
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

  // ------------------------------------------------------------ Altar Siege
  const zoneAt = (i) => SIEGE_ZONES[((i % SIEGE_ZONES.length) + SIEGE_ZONES.length) % SIEGE_ZONES.length];
  function newSiegeStats() {
    return { hold: SIEGE_ZONES.map(() => ({ ember: 0, frost: 0 })), contested: 0, empty: 0, hops: [], overtime: null };
  }
  function zoneStart() {
    S.zone = { i: 0, hopAt: t() + S.hop, warned: false, owner: null, contested: false, inside: { ember: 0, frost: 0 } };
    S.stats.siege = newSiegeStats();
  }
  function zoneEvent(type, extra = {}) { ctx.broadcast({ t: 'matchZone', type, zone: zonePublic(), ...extra }); }
  // Living wizards standing in the circle (on the ground, or flying low), by team
  function occupants() {
    const z = zoneAt(S.zone.i), by = { ember: [], frost: [] };
    for (const p of fighters()) {
      if (p.dead || !p.team || (p.p[1] || 0) > SIEGE.maxY) continue;
      if (Math.hypot(p.p[0] - z.x, p.p[2] - z.z) <= z.r) by[p.team].push(p);
    }
    return by;
  }
  function zoneTick(dt) {
    const now = t(), Z = S.zone, st = S.stats.siege;
    // hop (not during overtime: the fight there decides it)
    if (!S.overtime) {
      if (!Z.warned && now >= Z.hopAt - SIEGE.warn) { Z.warned = true; zoneEvent('warn', { to: zoneAt(Z.i + 1).name }); }
      if (now >= Z.hopAt) {
        st.hops.push(+now.toFixed(2));
        Z.i = (Z.i + 1) % SIEGE_ZONES.length; Z.hopAt = now + S.hop; Z.warned = false;
        zoneEvent('hop', { to: zoneAt(Z.i).name });
      }
    }
    const by = occupants();
    const e = by.ember.length, f = by.frost.length;
    Z.inside = { ember: e, frost: f };
    const wasContested = Z.contested, wasOwner = Z.owner;
    Z.contested = !!(e && f);
    Z.owner = Z.contested ? null : e ? 'ember' : f ? 'frost' : null;
    if (Z.contested) st.contested += dt;
    else if (!Z.owner) st.empty += dt;
    else {
      const team = Z.owner, n = by[team].length;
      const rate = n >= 2 ? SIEGE.rate2 : SIEGE.rate1;
      S.scores[team] = Math.min(100, S.scores[team] + rate * dt);
      st.hold[Z.i][team] += dt;
      for (const p of by[team]) {
        p.mPts = (p.mPts || 0) + rate * dt / n;   // each holder's share of the capture
        ctx.addUltCharge(p, SIEGE.ult * dt);
      }
    }
    if (Z.contested !== wasContested || Z.owner !== wasOwner) zoneEvent(Z.contested ? 'contested' : Z.owner ? 'held' : 'empty', { owner: Z.owner });
  }
  function siegeSummary() {
    const st = S.stats.siege;
    const r1 = (v) => +v.toFixed(1);
    return { hold: SIEGE_ZONES.map((z, i) => ({ name: z.name, ember: r1(st.hold[i].ember), frost: r1(st.hold[i].frost) })),
      contested: r1(st.contested), empty: r1(st.empty), hops: st.hops.length, overtime: st.overtime };
  }
  // Debug: a pinned, bound bot of `team` at (x, z), for testing contests. dummy: false removes it.
  function setDummy(by, d) {
    for (const p of [...players.values()]) if (p.dummy) ctx.removePlayer(p.id);
    if (!d || !TEAMS[d.team]) return;
    S.filling = d.team;
    try { ctx.addBot('easy'); } finally { S.filling = null; }
    const p = [...players.values()].filter(q => q.bot && q.team === d.team).sort((a, b) => b.id - a.id)[0];
    if (p) { p.dummy = true; p.pin = { x: +d.x || 0, z: +d.z || 0 }; p.fill = false; p.name = 'Dummy'; }
  }
  function pinDummies() {
    const now = t();
    for (const p of players.values()) {
      if (!p.pin || p.dead) continue;
      p.p = [p.pin.x, 0, p.pin.z];
      p.rootUntil = p.silenceUntil = now + 0.5;
    }
  }
  function zonePublic() {
    if (!S.zone) return null;
    const Z = S.zone, z = zoneAt(Z.i), n = zoneAt(Z.i + 1);
    return { i: Z.i, x: z.x, z: z.z, r: z.r, name: z.name, owner: Z.owner, contested: Z.contested, inside: Z.inside,
      next: { x: n.x, z: n.z, r: n.r, name: n.name }, nextAt: S.phase === 'live' && !S.overtime ? Math.max(0, +(Z.hopAt - t()).toFixed(1)) : null };
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
    S.overtime = null;
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
    // siege: the circle stands at its first spot during the warm-up (nothing scores until live)
    S.zone = null;
    if (S.mode === 'siege') zoneStart();
  }
  function startWarmup() {
    S.votes.clear(); S.results = null;
    resetArena();
    setPhase('warmup', S.times.warmup);
  }
  function startLive() {
    clearStats();
    for (const p of players.values()) resetUlt(p);
    S.zone = null;
    if (S.mode === 'siege') zoneStart();
    setPhase('live', S.cap ?? M().cap);
  }
  function mvpScore(p) { return (p.kills || 0) * 100 + (p.mDmg || 0) + (p.mPts || 0) * 10 - (p.deaths || 0) * 30; }
  function endMatch(reason) {
    const list = fighters();
    let winner = null;
    if (M().teams) {
      const sc = (v) => S.mode === 'siege' ? Math.round(v * 10) / 10 : Math.floor(v);
      const e = sc(S.scores.ember), f = sc(S.scores.frost);
      winner = e === f ? null : e > f ? 'ember' : 'frost';
    } else {
      const best = [...list].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      winner = best[0] && (!best[1] || best[0].kills > best[1].kills) ? best[0].id : null;
    }
    const e0 = (v) => S.mode === 'siege' ? Math.round(v * 10) / 10 : Math.floor(v);
    const mvp = [...list].sort((a, b) => mvpScore(b) - mvpScore(a))[0];
    S.results = {
      mode: S.mode, reason, winner, mvp: mvp ? mvp.id : null,
      scores: M().teams ? { ember: e0(S.scores.ember), frost: e0(S.scores.frost) } : null,
      players: list.map(pub).sort((a, b) => b.kills - a.kills || b.pts - a.pts || a.deaths - b.deaths),
      ff: S.stats.ff,
      siege: S.mode === 'siege' ? siegeSummary() : null,
    };
    console.log(`[match] ${S.mode} over (${reason}): winner ${winner}, mvp ${mvp?.name}`);
    ctx.broadcast({ t: 'matchEnd', results: S.results });
    setPhase('end', S.times.end);
  }
  function startVote() { S.votes.clear(); setPhase('vote', S.times.vote); }
  function tallyVotes() {
    const n = { ffa: 0, tdm: 0, siege: 0 };
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
      scores: S.mode === 'siege' ? { ember: +S.scores.ember.toFixed(1), frost: +S.scores.frost.toFixed(1) } : { ember: Math.floor(S.scores.ember), frost: Math.floor(S.scores.frost) },
      zone: S.mode === 'siege' && (S.phase === 'live' || S.phase === 'warmup') ? zonePublic() : null,
      overtime: S.overtime ? Math.max(0, +(S.overtime.until - now).toFixed(1)) : null,
      votes: S.phase === 'vote' ? tallyVotes() : null,
    };
  }

  return {
    // exposed for objectives.js and the test harness
    state: () => S, modes: MODES, teams: TEAMS, zones: SIEGE_ZONES, zoneAt, occupants: () => S.zone ? occupants() : null, matchPublic,

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
      const enemyDist = (sp) => { let d = Infinity; for (const q of players.values()) if (!q.dead && q.team && q.team !== p.team && q !== p) d = Math.min(d, Math.hypot(q.p[0] - sp[0], q.p[2] - sp[2])); return d; };
      // Altar Siege: always at your own team's far edge (map.js SIEGE_SPAWNS), however near the zone is, so a
      // death costs a walk back into the fight.
      if (S.mode === 'siege' && C.SIEGE_SPAWNS?.[p.team]) {
        const pts = C.SIEGE_SPAWNS[p.team], safe = pts.filter(sp => enemyDist(sp) > 8);
        const pick = safe.length ? safe : pts;
        return pick[Math.floor(Math.random() * pick.length)];
      }
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
      if (!p.bot && !humans().some(q => q !== p)) { S.paused = true; S.phase = 'warmup'; S.zone = null; S.results = null; }
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
    onPickup() {},
    onDrop() {},
    onPropBroken() {},
    canThrow() { return true; },

    tick(dt) {
      const now = t();
      if (S.paused) return;
      if (S.setPhaseOnTick) { S.setPhaseOnTick = false; balanceTeams(); startWarmup(); }
      pinDummies();
      if (now >= S.fillCheckAt && now >= S.graceUntil) { S.fillCheckAt = now + 1; fillBots(); }
      if (S.phase === 'live') {
        if (S.mode === 'siege') zoneTick(dt);
        checkWin();
        if (S.phase === 'live' && now >= S.phaseEnd) {
          if (S.mode === 'siege' && S.zone?.contested && !S.overtime) {
            // the cap hit mid-fight: play on until the zone is clear, at most overtimeMax more
            S.overtime = { until: now + S.overtimeMax, at: now };
            S.stats.siege.overtime = { start: +now.toFixed(2) };
            ctx.broadcast({ t: 'matchOvertime', until: S.overtimeMax });
          } else if (!S.overtime) endMatch('time');
          else if (!S.zone.contested || now >= S.overtime.until) {
            S.stats.siege.overtime.length = +(now - S.overtime.at).toFixed(1);
            endMatch('overtime');
          }
        }
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
        if (msg.hop !== undefined) S.hop = num(msg.hop, 6, 600) ?? SIEGE.hop;
        if (msg.overtime !== undefined) S.overtimeMax = num(msg.overtime, 1, 120) ?? SIEGE.overtime;
        if (msg.dummy !== undefined) setDummy(p, msg.dummy);
        // pinBots: every bot frozen where it stands (rooted and silenced), for UI tests; false lets them go
        if (msg.pinBots !== undefined) for (const q of players.values()) if (q.bot && !q.dummy) q.pin = msg.pinBots ? { x: q.p[0], z: q.p[2] } : null;
        if (DIFFS.includes(msg.botDiff)) S.botDiff = msg.botDiff;
        if (msg.spectate) {
          p.spectator = true; p.team = null;
          ctx.respawn(p);
        }
        if (msg.mode && MODES[msg.mode]) { setMode(msg.mode); startWarmup(); }
        if (msg.skip) {
          if (S.phase === 'live') endMatch('skip');
          else S.phaseEnd = t();
        }
        return true;
      }
      if (msg.t === 'matchStats') {
        ctx.send(p.id, { t: 'matchStats', stats: S.stats, match: matchPublic(), players: fighters().map(pub),
          siege: S.mode === 'siege' && S.stats.siege ? siegeSummary() : null });
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
