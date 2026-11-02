// Thin WebSocket wrapper with a message queue drained by the game loop.
const serverUrl = () => window.WA_SERVER || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
const UNAVAILABLE = { t: 'stats', unavailable: true };

// Round 19: the stats panel from the join screen (no game socket yet): a short-lived socket, auth with the CrazyGames token
// if there is one, then { t: 'stats' }; resolves with the reply, or { unavailable } after `ms`. Never rejects.
export function fetchStats(token, ms = 8000) {
  return new Promise((resolve) => {
    let ws, done = false;
    const end = (msg) => { if (done) return; done = true; clearTimeout(timer); try { ws?.close(); } catch {} resolve(msg); };
    const timer = setTimeout(() => end(UNAVAILABLE), ms);
    try { ws = new WebSocket(serverUrl()); } catch { end(UNAVAILABLE); return; }
    ws.onopen = () => {
      if (token) ws.send(JSON.stringify({ t: 'auth', token }));
      ws.send(JSON.stringify({ t: 'stats' }));
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.t === 'stats') end(m); };
    ws.onerror = () => end(UNAVAILABLE);
    ws.onclose = () => end(UNAVAILABLE);
  });
}

export class Net {
  constructor() {
    this.ws = null;
    this.queue = [];
    this.connected = false;
    this.onClose = null;
    this.statsWaiters = [];   // round 19: requestStats() promises waiting for the server's { t: 'stats' }
  }

  // round 11: `pick` is { loadout, voice } from the builder. Round 17: `room` is '' or undefined (a public match), 'new'
  // (a new private room) or a room's code.
  connect(name, pick, difficulty, room) {
    return new Promise((resolve, reject) => {
      // round 14: the CrazyGames build sets window.WA_SERVER (config.js) to the Render server; our own site leaves it unset
      const ws = new WebSocket(serverUrl());
      this.ws = ws;
      ws.onopen = () => { this.connected = true; this.send({ t: 'join', name, loadout: pick?.loadout, voice: pick?.voice, difficulty, room: room || undefined }); };
      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'welcome') resolve(msg);
        else if (msg.t === 'stats') { for (const w of this.statsWaiters.splice(0)) w(msg); }   // (not the game loop's)
        else this.queue.push(msg);
      };
      ws.onerror = () => reject(new Error('Could not reach the server'));
      ws.onclose = () => { this.connected = false; this.onClose?.(); };
    });
  }

  // Leaving on purpose (the pause menu's Leave match): no "disconnected" notice.
  close() { this.onClose = null; this.ws?.close(); }

  // Round 19: the stats panel in game, over this socket; resolves with the reply, or { unavailable } after `ms`.
  requestStats(ms = 8000) {
    if (!this.connected) return Promise.resolve(UNAVAILABLE);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.statsWaiters = this.statsWaiters.filter(w => w !== done); resolve(UNAVAILABLE); }, ms);
      const done = (msg) => { clearTimeout(timer); resolve(msg); };
      this.statsWaiters.push(done);
      this.send({ t: 'stats' });
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  drain() {
    const q = this.queue; this.queue = []; return q;
  }
}
