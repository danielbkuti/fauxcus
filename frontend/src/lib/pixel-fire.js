/* <pixel-fire> — 8-bit fire background. No dependencies.
   Attributes (all optional): pixel-size="8" height="42" fps="18" wind="0" bands="9" background="#201e1d"
   Respects prefers-reduced-motion (renders a single still frame). */
(() => {
  const PALETTE = ['#7c1405', '#dd2b0f', '#ec3013', '#f2621a', '#f78f1e', '#fbb826', '#fde047', '#fff4b8', '#fffdf2'];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const L = 36;

  class PixelFire extends HTMLElement {
    static get observedAttributes() { return ['pixel-size', 'bands', 'background']; }
    num(name, d) { const v = parseFloat(this.getAttribute(name)); return isNaN(v) ? d : v; }

    connectedCallback() {
      if (!this.canvas) {
        this.style.display = this.style.display || 'block';
        if (getComputedStyle(this).position === 'static') this.style.position = 'relative';
        this.canvas = document.createElement('canvas');
        Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block', pointerEvents: 'none' });
        this.prepend(this.canvas);
      }
      this.applyBg(); this.buildPalette(); this.resize();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this);
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (still) { for (let i = 0; i < 120; i++) this.step(); this.draw(); return; }
      this.last = 0;
      const loop = (t) => {
        this.raf = requestAnimationFrame(loop);
        if (document.hidden || t - this.last < 1000 / this.num('fps', 18)) return;
        this.last = t; this.step(); this.draw();
      };
      this.raf = requestAnimationFrame(loop);
    }
    disconnectedCallback() { cancelAnimationFrame(this.raf); this.ro && this.ro.disconnect(); }
    attributeChangedCallback(n) {
      if (!this.canvas) return;
      if (n === 'background') this.applyBg();
      if (n === 'bands') this.buildPalette();
      if (n === 'pixel-size') this.resize();
    }
    applyBg() { this.style.background = this.getAttribute('background') || '#201e1d'; }
    buildPalette() {
      const b = Math.max(3, Math.min(PALETTE.length, this.num('bands', PALETTE.length)));
      this.colors = PALETTE.slice(PALETTE.length - b).map(hex);
    }
    resize() {
      const px = this.num('pixel-size', 8);
      const W = Math.max(8, Math.ceil(this.clientWidth / px));
      const H = Math.max(8, Math.ceil(this.clientHeight / px));
      if (W === this.W && H === this.H) return;
      this.W = W; this.H = H;
      this.canvas.width = W; this.canvas.height = H;
      this.ctx = this.canvas.getContext('2d');
      this.img = this.ctx.createImageData(W, H);
      this.fire = new Uint8Array(W * H);
      for (let x = 0; x < W; x++) this.fire[(H - 1) * W + x] = L;
    }
    step() {
      const { W, H, fire } = this;
      if (!fire) return;
      const k2 = 2 * L / Math.max(1, H * this.num('height', 42) / 100);
      const wind = this.num('wind', 0) / 100;
      const base = (H - 1) * W;
      for (let x = 0; x < W; x++) fire[base + x] = Math.random() < 0.12 ? L - 6 - ((Math.random() * 8) | 0) : L;
      for (let x = 0; x < W; x++) {
        for (let y = 1; y < H; y++) {
          const src = y * W + x, p = fire[src];
          if (p === 0) { fire[src - W] = 0; continue; }
          const r = (Math.random() * 3.99) | 0;
          let dx = 1 - r;
          if (wind && Math.random() < Math.abs(wind)) dx += wind > 0 ? 1 : -1;
          let nx = x + dx;
          if (nx < 0 || nx >= W) nx = x;
          const c = (r & 1) ? k2 : 0;
          const v = p - ((c | 0) + (Math.random() < c % 1 ? 1 : 0));
          fire[(y - 1) * W + nx] = v < 0 ? 0 : v;
        }
      }
    }
    draw() {
      const { W, H, fire, img, colors } = this;
      if (!img) return;
      const d = img.data, n = colors.length;
      for (let i = 0; i < W * H; i++) {
        const v = fire[i], o = i * 4;
        if (v === 0) { d[o + 3] = 0; continue; }
        const c = colors[Math.min(n - 1, Math.floor((v / (L + 1)) * n))];
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
      this.ctx.putImageData(img, 0, 0);
    }
  }
  customElements.define('pixel-fire', PixelFire);
})();
