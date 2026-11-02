# Round 19 brief: stats panel and leaderboard

Ty wants players to see their own stats and the top players. "I don't mind if kills against bots count. I don't even
care if private matches count. It's not that serious." So every match counts, with no anti-farming rules.

## Server (environment agent: `server/saves.js`, owner of Supabase access; spells agent for the message hook)
- **Message `{t:'stats'}`** (rate-limited to about 1 every 5 s per socket). The reply is
  `{t:'stats', me, recent, board:{week, all}, rank:{week, all}}`:
  - `me`: the player's `player_stats` row plus derived values (win rate, K/D, average damage per match, top 3 spells by
    kills from `per_spell`). Null for guests.
  - `recent`: the last 10 `match_results` rows (place, kills, deaths, damage, date).
  - `board.week`: the top 25 by **wins**, with **kills** as the tie-breaker, over `match_results` from the last 7 days.
    Weeks reset Monday 00:00 UTC; use `date_trunc('week', now())`.
  - `board.all`: the top 25 from `player_stats`, ordered the same way.
  - `rank`: the requesting player's position on each board, even outside the top 25.
- **Implementation:**
  - Add a SQL migration with two read functions (`leaderboard(period text, lim int)` and
    `player_rank(p_player uuid, period text)`), `security definer`, with execute granted to the service role only.
    Post the SQL in requests.md; the coordinator applies it with the Supabase MCP.
  - Cache the boards in memory for 60 s. Per-player data is fetched when asked.
  - No Supabase configured, or an error: reply `{t:'stats', unavailable:true}`.
- The leaderboard rows hold only the username and the numbers. No IDs go to the client.

## Client (characters agent: select.js and select.css; a small net hook from spells)
- **A "Stats" button** in the builder's top bar, next to "How to play", which is also in the Esc menu. It opens a panel
  with two tabs:
  - **Your stats:**
    - big numbers for matches, wins, win rate, kills, K/D, damage, healing and podiums, plus play time
    - your top 3 spells (with icons)
    - your last 10 matches
    - guests see "Log in to CrazyGames to track your stats" (text only, no button)
  - **Leaderboard:**
    - a **This week / All time** toggle
    - the top 25 with rank, username, wins and kills
    - your own row highlighted, with your rank pinned at the bottom if you're outside the top 25
- **States:** a loading spinner, an empty board ("Be the first on the board!"), and "Stats unavailable right now".
- Matches the existing UI style, readable at 1280×720, keyboard and Esc friendly.
- **Privacy note:** add "CrazyGames usernames and match stats appear on the in-game leaderboard."

## Tests and verification
- Unit tests for the stats handler against the stub PostgREST (the shapes, the guest case, the unavailable case, the
  rate limit).
- The coordinator applies the migration, inserts a few `test_` players with matches, and checks the board order and
  rank through the real database. Then the test rows are deleted.
- Playwright screenshots of both tabs.
- Then Ty plays, then the push and the zip rebuild (on Ty's go-ahead), then Ty re-uploads the build.
