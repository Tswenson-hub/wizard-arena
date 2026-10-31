// Keyboard + pointer-lock mouse input.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // keys pressed this frame
    this.mouseDX = 0; this.mouseDY = 0;
    this.lmb = false; this.rmb = false;
    this.lmbPressed = false; this.rmbPressed = false; this.rmbReleased = false;
    this.locked = false;
    this.enabled = false;
    this.onLockChange = null;
    this.onLockError = null;      // round 14: the browser refused the lock (an iframe without pointer-lock, too soon after Esc...)

    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 2) { this.rmb = true; this.rmbPressed = true; }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) { if (this.rmb) this.rmbReleased = true; this.rmb = false; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.lmb = this.rmb = false; }
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.onLockError?.());
  }

  requestLock() {
    const plain = () => { try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch {} };
    try { this.canvas.requestPointerLock({ unadjustedMovement: true })?.catch?.(plain); }
    catch { plain(); }
  }

  down(code) { return this.keys.has(code); }
  justPressed(code) { return this.pressed.has(code); }

  // Call at the end of every frame.
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0; this.mouseDY = 0;
    this.lmbPressed = this.rmbPressed = this.rmbReleased = false;
  }
}
