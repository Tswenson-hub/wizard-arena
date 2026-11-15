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
async ({ url, name, seconds, room, proto }) => new Promise((resolve) => {
  const out = { welcome: null, roomError: null, names: [], bots: [], snaps: 0, keys: [], filled: [], msgs: [], closed: false, error: null, players: [] };
  const names = new Set(), bots = new Set(), keys = new Set(), filled = new Set(), msgs = new Set();
  const fin = () => { out.names = [...names]; out.bots = [...bots]; out.keys = [...keys]; out.filled = [...filled]; out.msgs = [...msgs]; resolve(out); };
  let ws;
  try { ws = new WebSocket(url); } catch (e) { out.error = String(e); return fin(); }
  // the old build's join: no proto, no map; round 24: `proto` set (22) is the round-23 build's join, which the server puts in a 'v22' room
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, difficulty: 'normal', ...(room ? { room } : {}), ...(proto ? { proto } : {}) }));
  ws.onerror = () => { out.error = 'socket error'; };
  ws.onclose = () => { out.closed = true; };
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    msgs.add(m.t);
    if (m.t === 'welcome') { out.welcome = m; for (const k of Object.keys(m)) keys.add(k); }
    if (m.t === 'roomError') out.roomError = m;
    if (m.t === 'snap') {
      out.snaps++;
      for (const k of Object.keys(m)) { keys.add('snap.' + k); if (Array.isArray(m[k]) ? m[k].length : m[k]) filled.add('snap.' + k); }
      for (const p of m.players || []) { if (p.name) names.add(p.name); if (p.bot) bots.add(p.bot); }
    }
  };
  setTimeout(() => { try { ws.close(); } catch {} fin(); }, seconds * 1000);
})
"""

def map_id(m):
    """match.map as a string (spells) or { id, name } (characters' shape): the id, or None."""
    return m.get('id') if isinstance(m, dict) else m

async def legacy_join(browser, ws_url, name='legacyjoin', seconds=6, room=None, proto=None):
    """`room`: a code to ask for (the old client's invite / code box); a current room's code must be refused with reason 'version'.
    `proto`: round 24, send this protocol version (22: the round-23 build pending at CrazyGames); None: the no-proto live build's join."""
    # from the game server's own origin (Chromium refuses the socket from about:blank's opaque origin)
    ctx = await browser.new_context()
    pg = await ctx.new_page()
    await pg.goto(ws_url.replace('wss://', 'https://', 1).replace('ws://', 'http://', 1).rstrip('/') + '/healthz')
    res = await pg.evaluate(JOIN_JS, {'url': ws_url, 'name': name, 'seconds': seconds, 'room': room, 'proto': proto})
    await ctx.close()
    return res

def report_code(res, code):
    """The old client asked for a current room's code: refused ('version'), and seated in a legacy public room instead.
    Returns True when it passes, or when the server has no legacy rooms yet."""
    w = res.get('welcome') or {}
    room, err = w.get('room') or {}, res.get('roomError') or {}
    if 'legacy' not in room:
        print(f'  note: legacy join with code {code}: no room.legacy on this server (pre-round-22), skipped'); return True
    ok = err.get('reason') == 'version' and room.get('legacy') is True and room.get('code') != code and not room.get('private')
    print(('  ok   ' if ok else '  FAIL ') + f"an old client's join with the new room's code {code}: roomError {err.get('reason')!r} ({err.get('text', '')[:60]!r}), landed in {room.get('id')} (legacy {room.get('legacy')}, private {room.get('private')})")
    return ok

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
    extra = lambda ks: sorted(k for k in ks if k.startswith('snap.') and k.split('.')[1] in ('runes', 'pads', 'portals', 'buffs'))
    seen, nonempty = extra(res.get('keys', [])), extra(res.get('filled', []))
    check(not nonempty, f'no runes or pads in the legacy room\'s snapshots (non-empty: {nonempty or "none"}; present but empty: {sorted(set(seen) - set(nonempty)) or "none"})')
    check(current_name not in res.get('names', []), f'{current_name!r} (a proto-22 client) is not in the legacy room')
    check(name not in (current_saw or set()), f"{current_name!r} never saw {name!r} in its own room's snapshots")
    return ok

def report_v22(res, current_name, current_saw, name='v22join'):
    """Round 24: a `proto: 22` join (the round-23 CrazyGames build, which bundles the OLD Sky Ruins layout) must land in a 'v22' room:
    the courtyard with runes and pads, never rotated, apart from the current (proto 24) client. Prints the checks; True when they pass,
    or when the server has no generations yet (pre-round-24: a note)."""
    ok = True
    def check(cond, label):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + label)
        ok = ok and bool(cond)
    w = res.get('welcome')
    print(f'v22 join (proto 22) as {name!r}:')
    check(w is not None and not res.get('error'), f"the server answered the proto-22 join with a welcome ({res.get('snaps')} snapshots, names {sorted(res.get('names', []))}{'; ' + res['error'] if res.get('error') else ''})")
    if not w: return False
    room, match = w.get('room') or {}, w.get('match') or {}
    print(f"  room {json.dumps(room)}; match target {match.get('target')}, map {match.get('map', '(no map field)')!r}")
    if 'gen' not in room:
        print('  note: this server has no room.gen yet (pre-round-24): the v22-room checks are skipped')
        return ok
    check(room.get('gen') == 'v22' and not room.get('legacy'), f"a v22 room (room.gen {room.get('gen')!r}, legacy {room.get('legacy')!r})")
    check(map_id(match.get('map')) == 'courtyard', f"the courtyard (match.map {match.get('map')!r})")
    runes, pads = w.get('runes'), w.get('pads')
    check(bool(runes) and bool(pads), f"runes and pads in the welcome ({len(runes or [])} runes, {len(pads or [])} pads: the round-23 client knows them)")
    check('snap.runes' in res.get('filled', []), "runes in the v22 room's snapshots")
    check(current_name not in res.get('names', []), f'{current_name!r} (a proto-24 client) is not in the v22 room')
    check(name not in (current_saw or set()), f"{current_name!r} never saw {name!r} in its own room's snapshots")
    return ok
