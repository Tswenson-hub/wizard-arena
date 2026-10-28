# Brief addendum: spells agent, round 5 (ultimates + mode hooks)

Ty approved these. You own the ultimates. A new **modes agent** owns `server/match.js`, `server/objectives.js` and
`public/js/match-ui.js`. The coordinator has put stubs and hook calls into `server.js` and `main.js` for it, so look for
`Match.` calls and keep them working as you edit.

## Ultimate (Q key, a new `ultimate` slot in each kit)
- **Charge, 0–100%, server-authoritative:**

  | Source | Rate |
  |---|---|
  | Damage dealt | +1% per 3 damage |
  | Passive | +1% every 2 s |
  | Kill | +5% |
  | Holding the relic | +2% per second; the modes agent calls `ctx.addUltCharge(p, pct)`, which you implement |

  Charge is kept through death and resets on use. Snapshots carry it, and the HUD shows a Q button with a charge ring
  and a glow when it's ready. Tuning goes in `SPELLBOOK`.
- **Cinder, Cataclysm:** aim a 10 m ground circle as Frostfall does (hold Q, release). Over 3 s, 8 meteors fall on
  random spots inside it, each with the usual shadow warning. 30 damage each, with knockback.
- **Gale, Eye of the Storm:** for 3 s she becomes a tornado.
  - She moves at 1.3× speed and can't be interrupted.
  - It pulls enemies within 7 m inward (server-applied velocity for bots; send pull vectors to clients) and deals 12
    damage per 0.5 s.
  - It launches them up and out on the final burst. Use the spin clip.
- **Rime, Absolute Zero:** a 1 s rune flare telegraph, then a 12 m blast.
  - Every enemy in line of sight (`pillarBlocks`, Bulwark walls count) takes 40 damage and is frozen for 2.5 s
    (Frostfall's freeze).
  - Wards don't block it.
- **Vesper, Crimson Eclipse:** for 4 s, tether up to 3 enemies within 12 m.
  - Each takes 10 HP per second, and she heals the same amount.
  - A tether breaks on lost line of sight or beyond 14 m.
  - Visuals: crimson beams.
- **Everything respects `Match.isEnemy`:** no friendly fire from any spell or ultimate in team modes, and bots never
  target teammates.
- **Bots:** fire the ultimate when it's worth it. Cataclysm on clustered enemies, Eye of the Storm when 2+ enemies are within
  7 m, Absolute Zero when 2+ enemies are visible within 12 m, Eclipse when 2+ enemies are near or when low on HP.
  - Every bot runs from a Cataclysm circle and an Eye of the Storm, and from Absolute Zero if it can break line of sight
    in time.
  - **Follow `Objectives.objectiveFor(bot)` hints** (moveTo / focus / guard / lift) when they're present.
- Cast poses: use existing clips (`cast_heavy`, `spin`, `tk_lift`). If one really needs a new clip, say which in
  `requests.md` and the coordinator will ask Ty.

## Verify
4 Hard bots, one per wizard, 3 × 120 s in FFA. Report K/D and how many ultimates each fired, and check no ultimate
dominates. Playwright screenshots of each ultimate. Update your hand-off.
