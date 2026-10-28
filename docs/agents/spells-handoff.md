# Spells hand-off

## Round 6: Ty's balance and identity pass

Files: `public/shared/constants.js`, the `kit` fields in `public/shared/wizards.js`, `server.js`, `server/bots.js`,
`public/js/{main,effects,wizard}.js`, `public/css/style.css`.

| Wizard | LMB | Space | Q |
|---|---|---|---|
| Cinder | **Fireball** | **Flame Ward** | Cataclysm |
| Gale | **Gale Shear** | Tempest Veil | Eye of the Storm |
| Rime | Glacial Skim | Glacial Bulwark (**6 × 4 m, freezes on touch**) | Absolute Zero |
| Vesper | **Hex Shards** | **Black Death** | **Night Cage** (replaces Crimson Eclipse) |

### Numbers
- **Eye of the Storm:** 8 per tick (was 12).
- **Meteor:** 44 (was 38).
- **Glacial Skim:** charges the ultimate 30 % less (`SPELLS.skim.ultCharge: 0.7`).
- **Spark** stays in the spellbook but is in no kit.

### Primaries
All three keep the magazine: 3 shots, a 1.5 s reload, and only the 3rd stuns or interrupts. `C.PRIMARY_KIND` maps a
primary to its projectile kind; `C.PRIMARY_KINDS` follow the magazine rule and share the finisher's stun immunity.
- **Fireball** (`fireball`): 24 m/s, radius 0.45, about 31 m. **20 damage, the 3rd 28** (`finDamage`), knockback 2. It
  started at the brief's 18/26; I raised it after the first balance runs, where Cinder still trailed in 2 of 3.
  - Visuals: a white-hot core in a flame shell; the 3rd is bigger, with a spinning ring.
  - Sound: Ty's `spark_cast`, pitched down.
- **Gale Shear** (`shear`): a wide (radius 0.85) blade at 30 m/s that's gone after **8 m**. 14 damage, knockback 3.
  - The 3rd is a wider crescent (radius 1.35, `finRadius`) that interrupts.
  - Visuals: a flat crescent of wind.
  - Bots playing Gale keep 2.5–6 m from their target.
- **Hex Shards** (`hex`): 11 damage. Each shot flies a quadratic Bézier from the hand to the aim point:
  - shot 1 curves in from the left, shot 2 from the right, and shot 3 lobs high (`C.hexCurve(from, to, i)`, `C.hexAt(curve, age)`);
  - after the curve's end it flies on along the end tangent;
  - the server and clients both run `hexAt`, so the drawn path is the real one;
  - the curve is sent as `proj.curve`, and the aim point is the client's `aimPoint()` (`cast.target`), clamped to 28 m;
  - it is blocked only by what it actually touches, so it bends around thin cover;
  - each shot is a spinning crimson glyph: a triangle, a diamond, then a crescent.

### Shields
`C.isWard(id)` is true for the Ward, Flame Ward and Black Death (hold Space, the stamina rules unchanged).
- **Flame Ward** (Cinder): a front-cone ward, drawn as a scrolling curtain of fire in front of her (two cylinder arcs).
  - **Every hit it blocks lashes back:** every enemy within 6 m in her 110° front cone takes 8 (`flame_lash`;
    unblockable, so two Flame Wards can't loop; never interrupts). Message: `flameLash {id, p, yaw, hits}`.
  - Bots don't feed shots into a Flame Ward facing them inside 7 m; they back off instead.
- **Black Death** (Vesper): blocks from **every** side (`allSides`), drawn as a near-opaque black shroud with a crimson
  lattice. Blocked hits flash crimson, and Flame Ward's flash orange.
  - **Absorbed damage charges the Lash:** it cuts the Lash cooldown by 0.1 s per point and stores +0.5 bonus damage per
    point (up to +14) for the next whip. Measured: a whip did 12 + 14 = 26.
  - Snapshot `lashBonus`. The RMB slot gets a crimson conic ring (`--whip`), and `body.setWhipGlow(bonus / 14)` is called.
  - Bots treat a Black Death as warded from every side (they hold fire into it).
- **Glacial Bulwark:** 6 m wide and 4 m tall (9 circles of r 0.4), 220 HP.
  - **An enemy touching it is frozen 1.5 s** (`bulwark_frost`: 4 damage plus Frostfall's freeze), at most once per wall
    per enemy every 3 s. Rime and teammates are unaffected.
  - Bots steer away from enemy walls.

### Night Cage (Vesper's Q, replaces Crimson Eclipse)
- **Casting:** hold Q to aim a 7 m circle (max 24 m away; a crimson-rimmed aim ring), release. For 4 s the ring is a
  barrier to **enemies only**: those inside at the cast can't get out, and everyone else can't get in. Vesper and
  teammates cross freely, and spells pass through.
- **Enforcement:** `C.cageClamp(pos, cage, inside)` is shared:
  - The server applies it in every `state` update for humans and every tick for bots.
  - It also applies after a Blink (the `tp` broadcast carries the clamped landing) and a Mirror Step.
  - The client clamps itself the same way, including its predicted Blink landing. A Smoke Screen dash collides with it like walking.
- **Flying over:** above 3 m (Skyward Flash) you pass over the ring, and the side you land on becomes yours (`cageSide`).
- **Messages:** `cage {id, owner, p, left, inside, foes}`, `cageSide`, `cageEnd`, and `welcome.cages`.
- **Visuals:** a ring of 44 jagged obsidian spikes rising from the ground, and a dark wall shimmering upward.
- **Bots:** they cage the spot covering the most enemies (2+, or 1 weak or stuck target after holding a full charge 12 s).
  Trapped bots just fight on (the server keeps them in).

### Whip (characters agent's API, in looks.js)
`Wizard.startLash` calls `body.setWhip?.('out')`; half a second after the lash ends (released or cancelled),
`setWhip('coiled')`. `setWhipGlow` follows `lashBonus`. Both are optional calls, so other bodies are unaffected.

### Verification (port 4101)
**Rules** (`/tmp/wa-spells/t_r6.mjs`, `t_cageblink.mjs`, raw sockets):
- **Fireball:** 18, 18, 26 with the 3rd interrupting (run before the bump to 20/28), at 24.0 m/s.
- **Shear:** 14 / 14 / 14 (the 3rd interrupting, kb 3, its radius 1.35) at 6 m; nothing at 11 m.
- **Hex:** control points left, right, then up 5.7 m; all three hit the aim point (11, 11, 11 with the 3rd interrupting).
- **Flame Ward:** 3 shears blocked; the Gale was burned 8 each time.
- **Black Death:** 3 fireballs from **behind** were all blocked, `lashBonus` 14; a Lash 7 s after the last one was
  accepted (13 s cooldown cut) and hit for 26, and the bonus went back to 0.
- **Bulwark:** touching it gave 4 damage + bind 1.5 + freeze; no second freeze within 3 s.
- **Night Cage:**
  - the trapped dummy, walking to 10 m, stopped at 6.55 m (7 − 0.45);
  - an outsider walking to the centre stopped at 7.45 m;
  - Vesper stood at 3.00 m;
  - a Gale blinking in landed at 7.45 m;
  - a Rime flying over was switched to inside (`cageSide`);
  - `cageEnd` after 4 s.

**Browser** (`t_r6.py`, `t_r6b.py`, `t_r6d.py`; no console errors):
- The Flame Ward curtain (`r6_flameward_watch.png`), the Black Death shroud (`r6_blackdeath_watch.png`), the whip ring on
  RMB (`r6_whip_ring.png`), and `setWhip` live (`r6_lash_whip_watch.png`).
- The Night Cage spikes and wall (`r6_cage_self.png`), its aim ring (`r6_cage_aim.png`), and Hex impacts (`r6_hex_self.png`).
- The machine was under heavy load (load average about 50 from other agents' browsers), so pages stalled for seconds. Timed
  in-browser readings (magazine counts, cage containment) lagged; the socket tests are the reliable ones.

**Balance** (4 Hard bots, one per wizard, FFA, 120 s each, with the server restarted between runs; one run where the
match loop went into an intermission was discarded):
| Wizard | First pass, Fireball 18/26 (3 runs) | Final, Fireball 20/28 (5 runs) | Final damage |
|---|---|---|---|
| Cinder | 4 / 5 (0.8) | **12 / 12 (1.0)** | 1340 |
| Gale | 10 / 11 (0.9) | 11 / 21 (0.52) | 1777 |
| Rime | 8 / 6 (1.3) | 20 / 13 (1.54) | 2185 |
| Vesper | 6 / 6 (1.0) | 8 / 11 (0.73) | 1187 |

- **Cinder no longer trails.** He's mid-pack with K/D 1.0.
- Fireball lands 33–50 % of shots; his **Meteor** lands only 3 of 69 against Hard bots, which is why Cinder needed the primary bump.
- **Rime now leads and Gale trails.** Gale dives in to 8 m with Shear and dies more, and the Eye nerf hit her too.
- Per-run kill counts are small, so this is noisy.
- I didn't touch Ty's numbers for Rime or Gale. Possible next steps: Shear 14 → 16, or Skim 11 → 10.
- Difficulty (`botmatch 90 s hard normal easy`): Hard 5/0 with 612 damage, Normal 2/2 with 298, Easy 1/6 with 162.

### Open
- **Environment** (filed in `requests.md`): `goats.js`'s `wardFacing` should accept Black Death from any side.
- **README** (coordinator) needs: the new primaries, Flame Ward, Black Death, the bigger Bulwark, and Night Cage; the messages
  `flameLash` and `cage/cageSide/cageEnd`; `proj.curve`, `cast.target`; the snapshot field `lashBonus`. Remove
  `eclipse*` and the snapshot field `eclipse`.

## Round 5: ultimates (Q) and the game-mode hooks

Files: `public/shared/constants.js` (`ULT_CHARGE`, four `SPELLBOOK` ultimates, `eye_burst`, `SLOT_INFO.ultimate`), the
`kit.ultimate` field in `public/shared/wizards.js`, `server.js`, `server/bots.js`, `public/js/{main,effects,wizard,net}.js`,
`public/index.html`, `public/css/style.css`.

### Charge (server-authoritative, `p.ult` 0–100, snapshot `ult`)
| Source | Rate |
|---|---|
| Damage dealt to an enemy | +1 % per 3 damage (`ULT_CHARGE.perDamage`); an ultimate's own damage (`ult: true`) never charges |
| Passive, while alive | +0.5 %/s (`passive`) |
| Kill | +5 % (`kill`) |
| Game modes | `ctx.addUltCharge(p, pct)` (clamped to 0–100); `ctx.resetUlt(p)` sets 0 |

Kept through death, reset to 0 on cast. A refused cast (`ultRefused`) keeps it. The HUD has a round Q button: a ring fills
with the charge in the wizard's spark colour, shows the %, and pulses with "READY" when full. A charge cheat,
`{t:'debugCharge'}`, works only when the server runs with `WA_DEBUG=1` (tests).

### The four ultimates (`{t:'ult', at?}`)
- **Cinder, Cataclysm:** hold Q to aim a 10 m circle (max 26 m away, the Frostfall aim), release. 8 meteors land on
  random, spread-out spots inside it (each spot is the farthest of 12 random tries from the others; minimum gap measured
  4.4 m), one every 3/7 s over 3 s. Each shows an ember shadow 1.1 s before it lands and a falling fireball for the last
  0.45 s. Each meteor does 30 damage + knockback 7 within 2.3 m. It's unblockable (from above), breaks props, pops decoys
  and stirs goats. Messages: `cataclysm {id, p, strikes:[{id,p,left}]}`, `meteorHit {id, p, hits}`. `welcome.strikes`.
- **Gale, Eye of the Storm:** 3 s tornado (`eyeStart/eyeEnd`). Gale moves at 1.3× and can't be interrupted (no stun,
  cancel, bind, slow or knockback; she still takes damage) and can't cast anything else. Enemies within 7 m are pulled in
  at 3.4 m/s: bots by the server (`botPull`), humans by `eyePull {pulls:[{id, v}]}` at 10 Hz, which their client adds to
  its movement (the speed check allows it). They take 12 damage per 0.5 s (6 ticks; a ward facing her soaks one for 10
  stamina; an ice wall in between blocks it). On the final burst, `eye_burst` does 15 damage, stun 0.6 and knockback 8
  outward, and `hit.launch` makes clients play a 0.8 s visual hop. Visuals: a violet wind funnel with streaks, motes
  spiralling in, and the pull circle. Gale repeats her `spin` clip throughout.
- **Rime, Absolute Zero:** a 1 s rune flare (`zeroStart`): Rime is rooted and can't be interrupted. A frost rune grows to
  12 m, a cold column rises and motes are drawn in. Then the blast (`zeroBlast`): every enemy within 12 m (3D) **in line of
  sight** (`pillarBlocks`, so pillars, trees, buildings and Bulwark walls, his own included, block it) takes 40 and is
  **frozen 2.5 s** (Frostfall's freeze; `hit.freeze`). Wards don't block it; a Tempest Veil does. Not from the air.
  `zeroCancel` if Rime dies during the flare.
- **Vesper, Crimson Eclipse:** tethers the nearest 3 enemies within 12 m in sight (`eclipse {id, targets}`); refused,
  keeping the charge, if there are none. For 4 s each loses 5 HP per 0.5 s (10/s) and Vesper heals what they lose (to
  100). It never interrupts. A tether snaps beyond 14 m or out of sight (`eclipseBreak`). Vesper can move and cast
  meanwhile. Visuals: pulsing crimson beams from her hand to each chest, with blood motes running toward her.

Cast poses use existing clips (`cast_heavy`, Gale's `spin`), so no new clip requests.

### `isEnemy` everywhere
`applyHit` already refused friendly hits. Now projectiles fly *through* teammates (no hit, no stop), teammates' held
props don't block them, and decoys only pop for enemies. Cyclone, Frostfall, relic blasts (an ally lifting your relic
doesn't set it off), Cataclysm, Eye, Absolute Zero and Eclipse all skip non-enemies. Bots never target, dodge or fear
teammates: they ignore teammates' projectiles, cyclones, lashes, Frostfalls, meteors and ultimates.

### Mode hooks (modes agent's requests, all wired)
`match.protectProp?.(prop)` is asked before every hit that would shatter a prop: protected props (the relic) are knocked
loose and land idle instead (`hitProp`). Also `ctx.resetUlt`, `ctx.resetGoats`, `join.difficulty` → `p.botPref`,
`teamColor ?? color` for the ring and nameplate (`Wizard.setColor`), and bot buttons disabled while `snap.match.teams`.
Holding the relic (`snap.match.relic.propId`), the hint reads "F / G set down the relic" and the F slot "Drop" (checked by
injecting a snapshot, `t_relichint2.py`).
**Bots** follow `objectiveFor(bot, world)` each think: `focus` overrides the target, `lift` walks to the prop and lifts it in
range, and `guard` (stay within 7 m) and `moveTo` override movement until close (combat continues from there). A bot never
throws a prop that `canThrow` refuses, so a relic holder keeps it.

### Bots and ultimates
- **When to fire** (rolled against aggression each think, once the charge is full):
  - Cataclysm: at the spot covering the most grounded enemies within 6 m (led a little), with 2+ there.
  - Eye: 2+ enemies within 6.5 m.
  - Absolute Zero: 2+ in sight within 11 m.
  - Eclipse: 2+ in sight within 10.5 m, or 1 when below 45 HP.
  - After 12 s on a full charge, they settle for one target (Eye: one within 4.5 m).
- **Getting out of the way** (after their reaction delay; whether they dodge at all uses the difficulty's dodge roll):
  - Cataclysm: walk out of the circle (centre sent as `cx, cz` on each strike); veil or mobility out from under a meteor about to land.
  - Eye of the Storm: run away while within 11 m; veil, flash up or use mobility once inside 7.5 m.
  - Absolute Zero: veil, raise a Bulwark toward Rime, walk to cover behind a pillar or out of range if there's time, else mobility.
  - Crimson Eclipse: mobility away, or walk to nearby cover, or run.

### Verification (port 4101; harnesses in `/tmp/wa-spells/`)
**Rules** (`t_ult.mjs`, raw sockets, `WA_DEBUG=1`):
- **Charge:** starts at 0; `ult` is refused without a full charge, and the charge is 0 after a cast.
- **Cataclysm:** 8 strikes inside the circle, landing from 1.10 to 4.10 s, minimum gap 4.4 m. Dummies in the cluster took
  30 each with knockback 7; one 25 m away took nothing. An aim 60 m out is clamped to 26.00 m.
- **Absolute Zero:** Rime is rooted (moved 0.00 m) and a spark during the flare doesn't interrupt (`int:false`). In
  sight at 6 m: 40, bind 2.5, frozen (snapshot `frozen` from 1.08 s to 3.55 s, measured at 50 ms). Nothing reaches a
  dummy behind a pillar, one at 13.5 m, or a veiled Gale (absorbed).
- **Eye of the Storm:** `eyePull` at 10 Hz with v = 3.4 m/s toward Gale for a dummy 5 m out, none for one at 10 m. Ticks
  of 12 ×6 on those inside, then the burst (15, kb 8, `launch` 2.2). Sparks on Gale do damage but `int:false`.
- **Crimson Eclipse:** tethers the 3 nearest. Ticks of 5, never interrupting. The tether to a dummy moved to 16 m snapped
  (`eclipseBreak`). Vesper went from 82 to 100 HP. A cast with nobody near is refused and keeps the charge.

**Teams** (a scratch copy with a stub `match.js` that splits teams by id parity, 6 Hard bots, 90 s): **0 friendly hits**
out of 179 enemy hits (sparks, skim, props, cyclone, Absolute Zero, Eye, relic, goats). With a stub `objectiveFor`,
`moveTo (10,10)` bots spent 64–73 % of snapshots within 8 m of it, and `guard` bots kept a median 5.3–5.9 m from their mate.

**Browser** (`t_ults.py`, `t_dbg2.py`; Playwright, no console errors):
- The HUD Q button shows the % then a pulsing READY ring in the wizard's colour (`ult_hud_ready.png`), and holding Q shows
  the 10 m aim circle (`ult_cata_aim.png`).
- Watcher views: meteor shadows and falling fireballs (`ult_cata_meteors.png`), impacts (`ult_cata_impact.png`), the
  tornado (`ult_eye.png`, `ult_eye_self.png`), the burst (`ult_eye_burst.png`), the rune flare and the frost blast
  (`ult_zero_flare.png`, `ult_zero_blast.png`, `ult_zero_frozen.png`), and the Eclipse beams (`ult_eclipse.png`).
- On a watcher: Gale plays `spin` throughout the Eye, and Vesper's tether map is live while tethered.
- Under swiftshader, the first use of each new effect stalls the page for 1–3 s while its shaders compile, so timed
  readings in the browser lag. The test warms them up first. On a real GPU this doesn't happen.

**Balance** (4 Hard bots, one per wizard, FFA, 3 × 120 s, `ultmatch.mjs`):
| Wizard | K/D (3 runs) | Ultimates fired | First at (s) | Ult damage | Ult kills |
|---|---|---|---|---|---|
| Cinder | 7 / 8 | 3 | 94, 68, 88 | 90 | 1 |
| Gale | 8 / 12 | 2 | 76, 79, – | 36 | 1 |
| Rime | 14 / 10 | 6 | 41, 62, 53 | 160 | 1 |
| Vesper | 9 / 8 | 3 | 66, 79, 70 | 35 | 1 |

- **No ultimate dominates.** Against Hard bots, which dodge them well, a cast averages 30 damage (Cataclysm), 18 (Eye),
  27 (Absolute Zero) or 12 (Eclipse: tethers are pulled out of sight quickly). That's one ultimate kill per wizard across 3
  runs. Hard bots are a harsh test: the 2+ targets the bots wait for rarely line up in a 4-bot FFA, and 3v3 clusters more.
- Rime fires twice as often because Glacial Skim's steady damage charges him faster (he dealt about 700 damage a run).
- Charge takes 40–95 s, so an 8-minute match gives about 5–8 ultimates per player.
- Difficulty spread (`botmatch 90 s hard normal easy`): Hard 2/2 with 321 damage, Normal 4/2 with 418, Easy 1/4 with 72.

### Notes for Ty and the other agents
- Judgement calls:
  - Cataclysm and Absolute Zero are unblockable; Eye ticks can be warded (10 stamina each).
  - The Tempest Veil absorbs every ultimate.
  - Eye and Absolute Zero lock the caster out of other spells.
  - Vesper may move and cast during Eclipse.
  - Absolute Zero can't be cast from the air; Eclipse can.
  - Eye of the Storm can deal 72 + 15 to someone who can't escape. That's the brief's numbers; watch it with humans.
- The Eye pull on humans is applied by their own client (the server allows the extra speed). A modified client could ignore it.
- README (coordinator) needs: the Q key, the `ultimate` kit slot, `ULT_CHARGE`, and the new messages (`ult`, `ultRefused`,
  `cataclysm`, `meteorHit`, `eyeStart/eyePull/eyeTick/eyeBurst/eyeEnd`, `zeroStart/zeroBlast/zeroCancel`,
  `eclipse/eclipseBreak/eclipseEnd`), the snapshot fields `ult, eye, zero, eclipse`, and `hit.freeze` / `hit.launch`.

## Round 4: wizards with fixed kits, five new spells, Frostfall

Commits: `eb16956` (kits and the five spells), `275d33b` (bot fixes, walls on join), `d1eb78d` (death, float, lash and
spin clips; Frostfall client), `08650c2` (Frostfall server and bots), `49b7511` (wizards.js kits: Rime power = Frostfall,
Gale mobility = Blink), plus request replies (`1d5db26`, `ec01861`).
Files: `public/shared/constants.js`, `server.js`, `server/bots.js`, `public/js/{main,wizard,effects,audio,net}.js`,
`public/index.html`, `public/css/style.css`, and the `kit` fields in `public/shared/wizards.js`.

## Kits and speeds (current)
| Wizard | LMB | RMB | E | Space | F | Run speed |
|---|---|---|---|---|---|---|
| Cinder | Spark | Meteor | **Smoke Screen** | Ward | Telekinesis | 5.3 m/s |
| Gale | Spark | Arcane Cyclone | **Blink** | **Tempest Veil** | Telekinesis | 6.2 m/s |
| Rime | Glacial Skim | **Frostfall** | Skyward Flash | Glacial Bulwark | Telekinesis | 5.3 m/s |
| Vesper | Spark | Sanguine Lash | Mirror Step | Ward | Trapped Relic | 5.3 m/s |

Bold entries are Ty's later changes. Speeds are the `speed` field next to `kit` in `wizards.js` (spells-owned). Wind-up
and ward speeds scale from it (2.0 and 2.6 m/s at 6.2). Backpedalling is capped at 3 m/s for everyone.

## What I built

### Wizard selection (the spellbook is gone)
- `constants.js`: `SPELLBOOK` has every spell (ward and telekinesis included), each with `slot`, `name`, `short` (the ability
  bar label), `blurb`, `cooldown` and its tuning. `SLOT_INFO` gives the key and label per slot. `kitOf(id)` returns a kit.
  `constants.js` re-exports `wizards.js`. `LOADOUT_SLOTS`, `DEFAULT_LOADOUT`, `spellsFor` and `sanitizeLoadout` are gone.
- Network: `join` carries `wizard`, and `{t:'wizard', id}` switches. Ids are validated with `isWizard`; `nope`, `__proto__`
  and `42` are ignored. A switch applies at once, or when a cast in progress ends (meteor, lash, cyclone, airborne), or at
  respawn if the player is dead. It's broadcast as `{t:'wizard', id, wizard, color}`. `playerPublic` carries `wizard`, plus
  `lashing, slow, bound, rooted, frozen`. Colour is `WIZARDS[id].color`.
- Client: the characters agent's picker is mounted in `#joinPicker` and `#pausePicker` (a `<select>` fallback stands in if
  the picker draws nothing). The choice is saved in `localStorage.wizardChoice`. A switch rebuilds the player's `Wizard`
  (model, ring and nameplate). The ability bar names all five spells from the kit. The scoreboard columns are Player / Wizard.
  The join panel is 760 px wide, as the characters agent asked.
- Bots: `addBot` takes `wizard` (random otherwise). `node bot.js` works unchanged.

### New spells (server rules + client + bots)
- **Glacial Skim**: 3 shards at ±6°, y 0.35, 26 m/s, about 22 m range, 11 damage each. A hit slows by 35 % for 2 s
  (refreshed, not stacked; sent as `hit.slow`, enforced in `updateLocal`). No stun. Colliders taller than 0.35 (fences,
  crops) block the shards. A ward blocks each for 6 stamina. Cast from the air, the shards start on the ground below.
- **Sanguine Lash**: `lashStart` begins a 1.5 s wind-up (red coil; slow movement; no ward); `lashRelease` then fires a
  28 m/s piercing whip (about 22 m). Each wizard on its path takes 12 damage and a 1.25 s bind (root + silence, no
  knockback). A hit or stun during the wind-up cancels it at no cost. If it binds nobody, the caster is rooted for 1 s
  (`lashMiss`, recovery pose). **A ward facing the caster stops it for 40 stamina, and that counts as a miss** (my call).
  Cooldown 13 s from release.
- **Mirror Step**: `{t:'mirror', dir, from}`. Three 7 m paths (centre and ±30° around the WASD direction); the server puts the
  caster on one at random and two decoys on the others. Decoys run at run speed for 2.5 s and are sent in snapshots
  (`decoys`) and `decoyEnd`. To others they're full `Wizard`s with the caster's model, name, nameplate, HP bar and run
  animation; on the caster's own screen they're see-through. One hit of anything pops them (projectiles stop; the lash
  cuts through), as do a cyclone, a relic blast, Frostfall and charging goats. Cooldown 7 s.
- **Glacial Bulwark** (Rime's Space; Rime can't ward): a wall 2.5 m ahead, 2.7 × 2.7 m, made of 5 circles
  (`kind:'bulwark', wall:id`) added to `C.COLLIDERS` on the server and every client (`wallUp`/`wallDown`, and `welcome`
  for walls already up). It blocks movement, projectiles, props, LOS, the camera and goats (they bonk on it). Projectiles
  damage it by their damage (`wallHit`); it breaks at 120 or after 10 s. A cyclone pulse and a relic blast don't pass
  it. Cooldown 12 s.
- **Trapped Relic**: tap F lifts (on release); hold F for 0.5 s on an idle prop curses it (`prop.cursedBy`, one per
  caster, sent only to the caster as `{t:'curse', id}`, shown as a faint red glyph). An enemy who lifts it: as the prop reaches
  their hold point, `relicBlast`: 45 damage within 3.5 m, knockback, credited to the curser. A ward facing the blast
  blocks it for 40. Lifting your own just lifts it and clears the curse; a curse also ends if the prop breaks.
- **Frostfall** (Ty's later request): hold RMB to aim a 3.2 m circle where the crosshair meets the ground (max 24 m),
  release to cast (`{t:'frostfall', at:[x, z]}`, 0.5 s `cast_heavy` pose). Everyone sees a growing dark shadow with a
  frost ring, and the ice block falls for the last 0.5 s. Impact 1.75 s after release: everyone in the circle with feet
  below 2 m takes 50 damage and is **frozen 1.5 s** (the lash's root + silence, with an ice-block visual instead of chains;
  `hit.bind` + snapshot `frozen`). Wards and walls don't help (`unblockable`). The caster isn't hit. It breaks props, pops
  decoys, and puts goats in the circle into `dizzyGoat`, or angers them. Cooldown 14 s.
  The warning counts down on the real clock (`performance.now`), so a slow machine still sees the ice land on time.

### Clip hooks (characters agent's bodies)
- `death`: played once and held, **no sink or tilt** (Ty's bug report). Bodies without it (Cinder, Gale) keep the sink.
- `float` (Rime): base state while airborne after the 0.5 s launch dash, back to normal on landing.
- `lash` (Vesper): plays over the lash wind-up. `spin` (Gale): plays over the cyclone spin.

### Bots (`server/bots.js`)
Bots play every kit. They dodge lash wind-ups aimed at them (wall it, ward it about 0.3 s before release, or step off the
line as it fires; mobility is saved for the whip itself). They treat skim shards like sparks (no reaction while airborne).
They raise a Bulwark against meteors, lashes, goat charges and cyclones. They go after decoys at Easy 50 %, Normal 29 %,
Hard 14 % (measured over 2000 trials each). They Mirror-Step, or now Blink, away when hurt and pressed. Vesper bots curse
props near their target, holding F for 0.5 s like a player, at most one curse per 8–14 s. Hard bots stop lifting a prop
that blew up on them for 40 s. Everyone walks, blinks or flashes out of a Frostfall shadow (react delay by difficulty).
Rime aims Frostfall where a rooted, stunned, casting or slowed target will be when the ice lands.

## Later changes (after the first hand-off), by commit
- **Frostfall from the air** (`58497d2`): the one power spell Rime can cast during Skyward Flash (`airCast`). The server
  accepts it from any height (range measured flat), and the cast pose layers over `float`. Rime bots sometimes flash up first.
- **Smoke Screen** (Cinder's E, `58497d2`): a 0.25 s backward dash (6.5 m, opposite her facing) that collides like walking;
  the client predicts it on real time, in small collision steps, and the server allows the dash speed. It leaves a 4 m × 3 m
  cloud for 5 s (+1 s fade): layered billboard puffs with an ember tint. Anyone inside is faded out (model, ring,
  nameplate, health bar) for viewers outside the same cloud. Bots can't see into, out of or through it (`C.smokeBlocks`):
  they drop a hidden target and head for where they last saw it. Bots use it to escape. Cooldown 8 s.
- **3-shot magazine** (`63ef725`): primary fire is 3 shots (a Skim volley counts as one), then a 1.5 s reload. R, or 2 s
  idle, reloads a partial magazine (`SPELLBOOK.*.magazine/reload/idleReload`). The server tracks `ammo/reloadUntil` and
  refuses shots while reloading. Only the 3rd shot (the finisher, `proj.fin`) stuns and interrupts (wind-ups, a lift);
  shots 1–2 just deal damage (and Skim's slow). `hit.int` tells clients. Spark stun immunity still applies. Skim's
  finisher cancels but doesn't stun (Skim never stuns, by Ty's first spec). Bots save the finisher for wind-ups (Hard 90 %,
  Normal 50 %, Easy never). HUD: ammo pips (the finisher's is gold) and a reload sweep.
  *Reload gesture:* none for now. A short "recharge" clip (about 0.6 s, e.g. a staff tap or a palm-up gather) would help.
- **Ty's sounds** (`db03fec`): `spark_cast` (fireball primary), `skim_cast` (ice primary, the 3.65–4.45 s burst), `blink`,
  `mirror_step` (split into 3), `smoke_screen`, `wall_up` (Ice wall; its break keeps the old shatter layers), `ward_loop` (ward
  shield, a 4 s crossfaded loop, kept quiet) and `kill_sting` (win_duel_kill_enemy: all its sound is in the first ~1 s, so 1.45 s
  with a fade). The sting plays flat, only for the killer, and restarts instead of stacking. The finisher plays `spark_cast`
  pitched down with a bright ring. `spark_cast_1–3` were removed. All credited in `public/sounds/CREDITS.md`.
- **Tempest Veil** (Gale's Space, `412e09b`): tap for a 3 s wind bubble that absorbs **every** hit from any side (damage,
  stun, slow, bind, knockback; frostfall and relic blasts too). Absorbed hits don't cancel her own casts. No stamina, no
  refresh; cooldown 10 s from activation. Visual: a swirling violet-white sphere, a gust on cast, a pop at the end and a
  flash per absorbed hit; the ward hum plays while it's up. Bots veil to dive into cyclone range and against goats,
  Frostfall and big spells; other bots hold fire on a veiled Gale and back away.
  **Pending (environment):** a goat ram should bounce off the veil (request in `requests.md`). Until then
  `goatCtx.killPlayer` refuses to kill a veiled wizard, so she survives, but the goat doesn't bounce.
- **Throwable goats, telekinesis side** (`dc4f58f`), per Ty's revision: telekinesis targets calm goats as well as props
  (server and client). A held goat floats at the hold point with the beam, blocks casting like a held prop, and shields its
  holder. F hurls it like a prop (`SPELLS.goat` = prop numbers, credited to the thrower, "X goated Y" on a kill); G sets
  it down. Death or stun drops it (goats.js). Lifting, throwing and landing never anger it; only a spell does (held
  and flying goats included), and spells hit goats at their height. Bots sometimes hurl a goat and dodge flying ones.
- **Sparks in the caster's colour** (`a7af67c`): `BOLT_COLORS` in `constants.js` (Cinder ember `ff5a1e`, Gale violet
  `b070ff`, Vesper crimson `ff1f3d`; Rime's Skim stays ice). A white-hot core inside the coloured glow, light, trail and
  impact burst; the finisher is bigger, with a lighter ring.
- **Speed, locomotion, gestures, telekinesis cooldown** (`2f37782`, `e09e94e`, `9e31c58`): the per-wizard speed and the
  backpedal cap above (applied on the client, in the server's speed check, for bots and decoys). Locomotion picks `run`
  at speed, `walk_fight` when slow (below 3 m/s, or in a wind-up, ward or slow) and `back` when moving backward, each
  time-scaled to ground speed ÷ the clip's measured speed (`clip.userData.speed`, capped at 6×). `tk_lift` and `tk_throw`
  play on a lift and a throw; `hit_waist` plays when a hurled prop or goat hits. Hurled objects already interrupt (only
  primary fire follows the magazine rule); a ward or veil that blocks them means no interrupt. Telekinesis has a 3 s
  lift cooldown (`liftCooldown`, shared with Trapped Relic) after letting go of anything (thrown, set down, knocked away,
  dropped) and after laying a curse. The server enforces it (`snap.liftCd`), the client predicts it with the F-button sweep,
  and bots respect it.

## Verification
Harnesses are in `/tmp/wa-spells/` (Playwright scripts `t_*.py`, raw-socket rule checks `t_server.mjs` and
`t_frost.mjs`, match harness `match.mjs`). There were no console errors in any browser run.

**Server rules (raw sockets; last run after all changes):** wall: HP 111 → … → 3, broken by the 14th spark, Rime
behind it untouched. Lash: pierced D1 and D2 (12 damage, bind 1.25, kb 0); a bound wizard moved 0.00 m and its cast
and ward were refused; measured bind about 1.27 s (20 Hz snapshots); a miss roots the caster (moved 0.00, free after
1 s); a spark during the wind-up → `lashCancel` and no lash; a ward → blocked, 40 stamina, caster rooted. Mirror: 2
decoys on the other two paths, a led spark pops a decoy (`surface:'decoy'`), the other expires after 2.5 s. Relic: curse
sent only to the caster; lifter and bystander take 45 each, credited to Vesper; the prop breaks and the curse clears.
Wizard: bad ids ignored; a switch during a meteor wind-up applies after release. Frostfall: impact at 1.78 s; ward and
wall don't stop it (50 damage, bind 1.5, frozen); an airborne Gale and a wizard 4.2 m out are untouched; frozen
wizards can't move or cast; refused on cooldown; range clamped to 24.00 m.

**Browser (Playwright, port 4101):**
- Selection: the choice survives a reload; each kit's bar reads (Cinder) `Spark | Meteor | Ward | Blink | Lift`,
  (Vesper) `Spark | Lash | Ward | Mirror | Relic`, (Rime) `Skim | Frostfall | Bulwark | Skyward | Lift`; `{t:'wizard', id:'nope'}` is ignored.
- Skim: 3 shards; a walking full client's velocity went from 6.06 to 4.12–4.5 m/s while slowed (35 % off 6.2 = 4.03),
  and back after 2 s; a fence stopped all 3 shards (`fence, fence, fence`, target untouched); a wizard at 6.4 m up was untouched.
- Bulwark: present on both clients (5 colliders); a walker stopped 0.77 m from the wall's centre line (circle 0.35 +
  player 0.45); sparks hit `bulwark`; a charging goat → `goatBonk`.
- Lash: the watcher sees the coil; the target shows `bound` with chains. Mirror: the watcher sees 2 decoys looking
  exactly like Vesper; Vesper sees 2 ghosts. Relic: curse glyph on Vesper's screen; on the watcher's client
  `cursedProp` is null and 0 curse messages arrive; the watcher lifts it → HP 100 → 55, feed "It was a trap!".
- Frostfall: aim circle shown, cast pose `cast_heavy`, shadow and frost ring, falling ice, impact mist; a target in the
  circle took 50. Ice block vs chains: `frozen_vs_bound.png`.
- Clips: Rime `float` mid-descent (own screen and watcher's), `idle` after landing, `stun` when sparked; Vesper `lash`;
  Gale `spin`. Death, stepped deterministically at 0.5 / 1.5 / 2.5 s: Rime and Vesper in `death` with model y 0 and
  tilt 0 at every step (Rime flat by 2.5 s); Gale sinks (-0.73 / -1.34 / -1.52); all are `idle` at ground level after respawn.

Screenshots, all looked at, in `/tmp/wa-spells/`: `picker_fallback.png` (the real picker), `hud_vesper.png`,
`scoreboard.png`, `lash_windup.png`, `bound.png`, `decoys_watcher.png`, `decoys_own.png`, `wall.png`,
`wall_far_side.png`, `curse_glyph.png`, `relic_blast.png`, `frost_aim.png`, `frost_shadow.png`, `frost_falling.png`,
`frost_frozen.png`, `frozen_vs_bound.png`, `rime_float.png`, `rime_stun.png`, `vesper_lash.png`, `gale_spin.png`,
`death_0.5.png`, `death_1.5.png`, `death_2.5.png`.

**Difficulty spread** (`botmatch.mjs 4101 90 hard normal easy`, 3 runs, random wizards, final code):
Hard 6/1, 4/1, 5/0 = **15 K / 2 D**; Normal 1/3, 1/3, 0/2 = **2 / 8**; Easy 0/3, 1/2, 0/3 = **1 / 8**. The spread holds.

**Wizard balance** (4 Hard bots, one per wizard, 120 s runs, `match.mjs`):
| Code state | Cinder | Gale | Rime | Vesper |
|---|---|---|---|---|
| First kits, 5 runs | 9 / 18 | 15 / 23 | 24 / 20 | 26 / 13 |
| After bot fixes (Blink escape, Vesper holds F to curse), 4 runs | 12 / 17 | 21 / 17 | 19 / 19 | 12 / 11 |
| Final (Frostfall, Gale on Blink), 3 runs | 5 / 10 | 11 / 14 | 14 / 9 | 12 / 10 |

Vesper's early lead came from bot asymmetries (instant curses, and only Mirror bots escaping when hurt), not the spells.
After those fixes nothing dominates, but **Cinder is consistently the weakest** (K/D about 0.5–0.7): the base kit
has no tool the others lack. Frostfall: 20 bot casts, 18 wizards inside a shadow at cast time, 3 caught. It's
dodgeable, and it pays off on rooted or slowed targets.

### Verification of the later changes
Raw-socket rule checks (`/tmp/wa-spells/t_*.mjs`) and Playwright (`t_*.py`), port 4101, no console errors:
- Frostfall from the air: accepted at 6.8 m up (flat range 8.00 m), 50 damage to the dummy; in the browser the cast lands
  and freezes a dummy (50, bind 1.5), and the watcher sees `float → cast_heavy (0.8 m up) → idle`.
- Smoke Screen: the dash goes exactly 6.5 m straight back and stops 0.45 m from a pillar behind. A dummy in the cloud is
  hidden from a viewer outside (fade 1 → invisible), and visible to a viewer inside. A Hard bot fired 5 sparks in 5 s
  at a visible Cinder, 0 while she stood in her smoke, and 2 once it cleared. (`smoke_outside.png`, `smoke_inside.png`)
- Magazine: shots 1–2 hit for 9 with `int:false` (no stun, the meteor wind-up survives); shot 3 is `fin` and stuns and
  cancels. A 4th shot during the reload is refused; firing works again after it. R and idle reloads work. Stun immunity:
  a second finisher 0.8 s after the first does 9 damage but doesn't re-stun. In the browser, 4 clicks give 3 projectiles,
  the 3rd `fin`, and pips 3 → 0 → 3. (`mag_reloading.png`)
- Sounds: all 25 manifest keys decode in Chromium. The sting plays on our kill, restarts on a second, and stays silent for others' kills.
- Tempest Veil: 4 sparks from front and back absorbed (HP 100); a finisher during the veiled cyclone wind-up is absorbed
  and the cyclone still pulses; the veil ends at 3.02 s; after it two plain shots land (HP 82) and a finisher cancels the
  wind-up; a recast is refused on cooldown. (`veil.png`)
- Goats: a lift doesn't anger; the goat follows its holder; the hurl hits a dummy for 22 (prop numbers) credited to the
  thrower; the goat lands and grazes; a miss lands calmly too; a spark at a held goat drops it and sends it charging the
  caster. In the browser: "F lift goat" → lifted → "F hurl goat · G set down" → dummy 100 → 78. (`goat_held2.png`)
- Spark colours: each caster's sparks arrive in its colour (`bolts_still.png`).
- Speeds: Cinder 5.29 m/s (`run` 1.13×), Gale 6.19 (`run` 1.30×), both backpedal at 3.0 (`back`). A wind-up walk plays
  `walk_fight`, and a lift plays `tk_lift`. A thrown crate interrupts a meteor wind-up (22, `int`); a ward facing it blocks, no stun.
- Telekinesis cooldown: about 2.7 s left right after a throw, a set-down or a curse; lifts are refused during it, and a lift
  3 s after the throw works.

**Balance with the later changes** (4 Hard bots, one per wizard, 120 s): after the magazine, Cinder 3/8, Gale 9/7,
Rime 10/7, Vesper 5/6 (3 runs). After the Veil, Gale 10/13 over 4 runs: not dominant, so the cooldown stays at 10 s.
After the speed change: Cinder 4/3, Gale 2/6, Rime 4/4, Vesper 5/3 (2 runs). Kills are much rarer since the magazine
and slower movement, so per-run numbers are noisy. Difficulty (botmatch, 3 × 90 s, final code): Hard 5 K / 2 D (damage
462, 265, n/a), Normal 8/5 (190, 214), Easy 5/12 (146, 182). By damage Hard is clearly ahead; by kills the spread is
blurrier than before.

## Known issues and notes
- **README** (coordinator) still describes the spellbook. It needs the wizard roster, the five kits, the new spells,
  the messages (`wizard`, `lashStart/lashRelease/lashCancel/lashMiss`, `mirror/decoyEnd`, `bulwark/wallUp/wallHit/
  wallDown`, `curse/relicBlast`, `frostfall/frostfallHit`) and the snapshot fields.
- `tools/test/spellmatch.mjs` throws now (it reads `player.loadout`); see `requests.md` for the replacement.
- Judgement calls Ty may want to revisit: a blocked lash counts as a miss (caster rooted); Glacial Skim cast from the air
  starts its shards on the ground under Rime; Trapped Relic lifts on F release (up to 0.5 s later than before) because a
  hold means curse; Frostfall doesn't hit its caster.
- Cinder may want a buff if Ty agrees with the numbers above (e.g. Meteor cooldown or damage); I didn't change his spells.
- Under swiftshader, the first seconds after joining stall while shaders compile (the new scenery and models), and long
  stalls can miss the 15 s heartbeat (the page then shows "Disconnected"). Tests warm up first. On a real GPU this doesn't happen.
- Rime's `float` hold, the death clips (no sink: they lie at ground level until the respawn moves them), Vesper's `lash` and
  Gale's `spin` are all wired; `back` is now the backward fight walk (it loops), and Smoke Screen plays it as a short one-shot.
- Swiftshader runs at 3–5 fps, so Playwright timing checks use events and the client's velocity, and the death screenshots
  step the animation by hand. On a real GPU none of this matters.
- Decoys are separate entities on the wire (`decoys` in snapshots), so a modified client could tell them apart.
  Visually they are identical.
