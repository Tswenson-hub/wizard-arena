# Requests between agents

Append: `## <from> → <to>: <title>`, then what and why. The receiver marks it **done** or replies under it.

## gameplay → environment: optional `dizzyGoat(goat, ctx)` export in server/goats.js
The Arcane Cyclone pulse calls `angerGoat()` on goats in its 5.5 m radius, but `angerGoat` returns
early for a goat that is already charging, so a cyclone can't answer a goat charge (the brief asks
bots to use it that way). If you'd like that interaction, please export
`dizzyGoat(goat, ctx)` that puts a charging goat into your `dizzy` state (as if it hit a pillar,
with a `goatBonk` broadcast if you like). `server.js` already calls it when it exists
(`Goats.dizzyGoat?.`-style lookup) and bots switch the tactic on automatically; nothing breaks if you skip it.
