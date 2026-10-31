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
      // round 14: the CrazyGames build sets window.WA_SERVER (config.js) to the Render server; our own site leaves it unset
      const ws = new WebSocket(window.WA_SERVER || `${proto}://${location.host}`);
      this.ws = ws;
      ws.onopen = () => { this.connected = true; this.send({ t: 'join', name, loadout: pick?.loadout, voice: pick?.voice, difficulty }); };
      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'welcome') resolve(msg);
        else this.queue.push(msg);
      };
      ws.onerror = () => reject(new Error('Could not reach the server'));
      ws.onclose = () => { this.connected = false; this.onClose?.(); };
    });
  }

  // Leaving on purpose (the pause menu's Leave match): no "disconnected" notice.
  close() { this.onClose = null; this.ws?.close(); }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  drain() {
    const q = this.queue; this.queue = []; return q;
  }
}
