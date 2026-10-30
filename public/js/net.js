// Thin WebSocket wrapper with a message queue drained by the game loop.
export class Net {
  constructor() {
    this.ws = null;
    this.queue = [];
    this.connected = false;
    this.onClose = null;
  }

  // round 11: `pick` is { loadout, voice } from the builder
  connect(name, pick, difficulty) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      ws.onopen = () => { this.connected = true; this.send({ t: 'join', name, loadout: pick?.loadout, voice: pick?.voice, difficulty }); };
      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'welcome') resolve(msg);
        else this.queue.push(msg);
      };
      ws.onerror = () => reject(new Error('Could not reach the server'));
      ws.onclose = (e) => { console.log('[net] socket closed', e.code, e.reason, e.wasClean); this.connected = false; this.onClose?.(); };
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  drain() {
    const q = this.queue; this.queue = []; return q;
  }
}
