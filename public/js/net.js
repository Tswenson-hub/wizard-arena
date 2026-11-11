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

// Round 21: is this CrazyGames player new? A short-lived socket sends their token; the server's { t: 'profile' } (username, save,
// stats with `matches`) resolves this, or { guest: true } for a token the server rejects. null after `ms` or on any error. Never
// rejects. main.js starts it at page load and waits for it at most 1.5 s at Ready (the first-visit detection).
export function fetchProfile(token, ms = 6000) {
  return new Promise((resolve) => {
    let ws, done = false;
    const end = (msg) => { if (done) return; done = true; clearTimeout(timer); try { ws?.close(); } catch {} resolve(msg); };
    const timer = setTimeout(() => end(null), ms);
    if (!token) { end(null); return; }
    try { ws = new WebSocket(serverUrl()); } catch { end(null); return; }
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.t === 'profile') end(m); };
    ws.onerror = () => end(null);
    ws.onclose = () => end(null);
  });
}

export class Net {
  constructor() {
    this.ws = null;
    this.queue = [];
    this.connected = false;
    this.onClose = null;
    this.statsWaiters = [];   // round 19: requestStats() promises waiting for the server's { t: 'stats' }
    this.ping = null;         // round 20: the round trip (ms, smoothed), from { t: 'ping' } every 2 s
    this.pingTimer = null;
  }

  // Round 20: measure the round trip (the server answers a ping at once; our last measure rides along for the scoreboard).
  startPing() {
    clearInterval(this.pingTimer);
    const ping = () => this.send({ t: 'ping', c: performance.now(), rtt: this.ping == null ? undefined : Math.round(this.ping) });
    ping();
    this.pingTimer = setInterval(ping, 2000);
  }
  onPong(msg) {
    const rtt = performance.now() - msg.c;
    if (!(rtt >= 0 && rtt < 10000)) return;
    this.ping = this.ping == null ? rtt : this.ping + (rtt - this.ping) * 0.3;
  }

  // round 11: `pick` is { loadout, voice } from the builder. Round 17: `room` is '' or undefined (a public match), 'new'
  // (a new private room) or a room's code. Round 21: `extra` rides along in the join ({ firstVisit: true }: a first-timer's
  // new public room fills with Easy bots).
  connect(name, pick, difficulty, room, extra = null) {
    return new Promise((resolve, reject) => {
      // round 14: the CrazyGames build sets window.WA_SERVER (config.js) to the Render server; our own site leaves it unset
      const ws = new WebSocket(serverUrl());
      this.ws = ws;
      ws.onopen = () => { this.connected = true; this.send({ t: 'join', name, loadout: pick?.loadout, voice: pick?.voice, difficulty, room: room || undefined, ...(extra || {}) }); this.startPing(); };
      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'pong') { this.onPong(msg); return; }
        msg.rx = performance.now();   // (round 20: when it arrived: the snapshots' timing for the interpolation)
        if (msg.t === 'welcome') resolve(msg);
        else if (msg.t === 'stats') { for (const w of this.statsWaiters.splice(0)) w(msg); }   // (not the game loop's)
        else this.queue.push(msg);
      };
      ws.onerror = () => reject(new Error('Could not reach the server'));
      ws.onclose = () => { this.connected = false; clearInterval(this.pingTimer); this.onClose?.(); };
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
