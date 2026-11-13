# Round 22: a join WITHOUT `proto` (what the live CrazyGames build sends), from a bare browser page on the test's own
# browser, so smoke.py and subpath_test.py can check the server's legacy path next to a current client:
#   - the server still answers the old join with a welcome (nothing else would keep the live build playable)
#   - once the server has legacy rooms (room.legacy in the welcome): the joiner is in one, it's the courtyard, no runes
#     or pads, and the current client of the same test is NOT in that room (and never saw the joiner in its snapshots)
#   - before that (a pre-round-22 server, e.g. live today): a note, nothing fails
# usage (from an async Playwright test, `b` the browser):
#   res = await legacy_join(b, 'ws://localhost:4105', 'legacyjoin', seconds=6)
#   ok = report(res, current_player_name, names_the_current_client_saw)
import json

JOIN_JS = r"""
async ({ url, name, seconds }) => new Promise((resolve) => {
  const out = { welcome: null, names: [], bots: [], snaps: 0, keys: [], msgs: [], closed: false, error: null, players: [] };
  const names = new Set(), bots = new Set(), keys = new Set(), msgs = new Set();
  const fin = () => { out.names = [...names]; out.bots = [...bots]; out.keys = [...keys]; out.msgs = [...msgs]; resolve(out); };
  let ws;
  try { ws = new WebSocket(url); } catch (e) { out.error = String(e); return fin(); }
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, difficulty: 'normal' }));   // the old build's join: no proto, no map
  ws.onerror = () => { out.error = 'socket error'; };
  ws.onclose = () => { out.closed = true; };
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    msgs.add(m.t);
    if (m.t === 'welcome') { out.welcome = m; for (const k of Object.keys(m)) keys.add(k); }
    if (m.t === 'snap') {
      out.snaps++;
      for (const k of Object.keys(m)) keys.add('snap.' + k);
      for (const p of m.players || []) { if (p.name) names.add(p.name); if (p.bot) bots.add(p.bot); }
    }
  };
  setTimeout(() => { try { ws.close(); } catch {} fin(); }, seconds * 1000);
})
"""

def map_id(m):
    """match.map as a string (spells) or { id, name } (characters' shape): the id, or None."""
    return m.get('id') if isinstance(m, dict) else m

async def legacy_join(browser, ws_url, name='legacyjoin', seconds=6):
    # from the game server's own origin (Chromium refuses the socket from about:blank's opaque origin)
    ctx = await browser.new_context()
    pg = await ctx.new_page()
    await pg.goto(ws_url.replace('wss://', 'https://', 1).replace('ws://', 'http://', 1).rstrip('/') + '/healthz')
    res = await pg.evaluate(JOIN_JS, {'url': ws_url, 'name': name, 'seconds': seconds})
    await ctx.close()
    return res

def report(res, current_name, current_saw, name='legacyjoin'):
    """Prints the checks; returns True when they pass (or the server has no legacy rooms yet)."""
    ok = True
    def check(cond, label):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + label)
        ok = ok and bool(cond)
    w = res.get('welcome')
    print(f'legacy join (no proto) as {name!r}:')
    check(w is not None and not res.get('error'), f"the server answered the old join with a welcome ({res.get('snaps')} snapshots in {len(res.get('names', []))} names: {sorted(res.get('names', []))}{'; ' + res['error'] if res.get('error') else ''})")
    if not w: return False
    room, match = w.get('room') or {}, w.get('match') or {}
    print(f"  room {json.dumps(room)}; match target {match.get('target')}, map {match.get('map', '(no map field)')!r}")
    if 'legacy' not in room:
        print('  note: this server has no room.legacy yet (pre-round-22): the legacy-room checks are skipped')
        return ok
    check(room.get('legacy') is True, f"a legacy room (room.legacy {room.get('legacy')})")
    # the courtyard: 'courtyard', or environment's frozen 'legacy' copy of the layout the live build bundles
    check(map_id(match.get('map', 'courtyard')) in ('courtyard', 'legacy'), f"the courtyard (match.map {match.get('map')!r})")
    runes, pads = w.get('runes'), w.get('pads')
    check(not runes and not pads, f'no runes or pads in the welcome (runes {runes!r}, pads {pads!r})')
    snap_extras = sorted(k for k in res.get('keys', []) if k.startswith('snap.') and k.split('.')[1] in ('runes', 'pads', 'portals', 'buffs'))
    check(not snap_extras, f'no rune or pad fields in the legacy room\'s snapshots ({snap_extras or "none"})')
    check(current_name not in res.get('names', []), f'{current_name!r} (a proto-22 client) is not in the legacy room')
    check(name not in (current_saw or set()), f"{current_name!r} never saw {name!r} in its own room's snapshots")
    return ok
