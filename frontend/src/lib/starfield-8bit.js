/* <starfield-8bit> — drop-in animated 8-bit starfield background.
   Usage: <script src="starfield-8bit.js"></script>
          <starfield-8bit style="position:fixed;inset:0;z-index:-1"></starfield-8bit>
   Attributes (all optional): pixel-size=4 density=1 seed=143 twinkle="true" twinkle-count=14 interval=240 first-delay=6
   JS: element.shoot() fires a shooting star. */
(() => {
  const PAL = { bg: '#05060b', dim: '#1c2338', dim2: '#2c3a5c', blue: '#3a7bd5', cyan: '#59d8ff', lav: '#c9b8ff', pale: '#ffe9d6', white: '#ffffff' };
  const rng = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const hue = r => { const v = r(); return v < 0.4 ? 'white' : v < 0.72 ? 'cyan' : v < 0.93 ? 'lav' : 'pale'; };

  class Starfield8bit extends HTMLElement {
    static get observedAttributes() { return ['pixel-size', 'density', 'seed', 'twinkle-count', 'interval', 'first-delay']; }
    num(n, d) { const v = parseFloat(this.getAttribute(n)); return isNaN(v) ? d : v; }
    connectedCallback() {
      if (!this.shadowRoot) {
        const sr = this.attachShadow({ mode: 'open' });
        sr.innerHTML = '<style>:host{display:block;position:relative;overflow:hidden;background:#05060b}canvas{position:absolute;left:0;top:0;display:block;image-rendering:pixelated;pointer-events:none}</style><canvas></canvas><canvas></canvas>';
        [this.base, this.fx] = sr.querySelectorAll('canvas');
      }
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.build(); this.resize();
      this.schedule(this.num('first-delay', 6) * 1000);
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this);
      this.raf = requestAnimationFrame(this.loop);
    }
    disconnectedCallback() { cancelAnimationFrame(this.raf); clearTimeout(this.timer); this.ro && this.ro.disconnect(); }
    attributeChangedCallback(n) {
      if (!this.base) return;
      if (n === 'interval' || n === 'first-delay') this.schedule(this.num('first-delay', 6) * 1000);
      else { this.build(); this.resize(); }
    }
    build() {
      const px = this.px = this.num('pixel-size', 4);
      const TW = this.TW = Math.round(2560 / px), TH = this.TH = Math.round(1440 / px);
      const r = rng(this.num('seed', 143)), area = TW * TH / 230400 * this.num('density', 1);
      const c = document.createElement('canvas'); c.width = TW; c.height = TH;
      const g = c.getContext('2d'); g.fillStyle = PAL.bg; g.fillRect(0, 0, TW, TH);
      const dot = (x, y, col) => { g.fillStyle = col; g.fillRect(((x % TW) + TW) % TW, ((y % TH) + TH) % TH, 1, 1); };
      for (let i = 0; i < 1800 * area; i++) dot(r() * TW | 0, r() * TH | 0, r() < 0.6 ? PAL.dim : PAL.dim2);
      for (let i = 0; i < 650 * area; i++) { const h = hue(r); dot(r() * TW | 0, r() * TH | 0, r() < 0.5 ? PAL[h] : (h === 'cyan' ? PAL.blue : PAL.dim2)); }
      const cands = [];
      for (let i = 0; i < 130 * area; i++) {
        const x = r() * TW | 0, y = r() * TH | 0, h = hue(r), arm = PAL[h === 'white' ? 'dim2' : 'blue'];
        dot(x, y, PAL.white); dot(x - 1, y, arm); dot(x + 1, y, arm); dot(x, y - 1, PAL.dim2); dot(x, y + 1, PAL.dim2);
        cands.push({ x, y, h, big: false });
      }
      for (let i = 0; i < 26 * area; i++) {
        const x = r() * TW | 0, y = r() * TH | 0, h = hue(r), L = 2 + (r() * 3 | 0);
        dot(x, y, PAL.white);
        for (let k = 1; k <= L; k++) {
          const col = k === 1 ? PAL[h] : k === L ? PAL.dim2 : (h === 'cyan' ? PAL.blue : PAL.dim2);
          dot(x + k, y, col); dot(x - k, y, col); dot(x, y + k, col); dot(x, y - k, col);
        }
        if (L >= 4) [[1, 1], [-1, -1], [1, -1], [-1, 1]].forEach(([a, b]) => dot(x + a, y + b, PAL.dim2));
        cands.push({ x, y, h, big: true, L });
      }
      const minD = 70 / (px / 4), tw = [], want = Math.round(this.num('twinkle-count', 14) * area);
      for (const s of cands.sort(() => r() - 0.5)) {
        if (tw.length >= want) break;
        if (tw.every(o => { const dx = Math.min(Math.abs(o.x - s.x), TW - Math.abs(o.x - s.x)), dy = Math.min(Math.abs(o.y - s.y), TH - Math.abs(o.y - s.y)); return dx * dx + dy * dy > minD * minD; }))
          tw.push({ ...s, period: 7 + r() * 9, off: r() * 16 });
      }
      this.tw = tw; this.tile = c;
    }
    resize() {
      const px = this.px, cols = Math.ceil(this.clientWidth / px) || 1, rows = Math.ceil(this.clientHeight / px) || 1;
      for (const cv of [this.base, this.fx]) { cv.width = cols; cv.height = rows; cv.style.width = cols * px + 'px'; cv.style.height = rows * px + 'px'; }
      this.W = cols; this.H = rows;
      const ctx = this.base.getContext('2d'); ctx.fillStyle = ctx.createPattern(this.tile, 'repeat'); ctx.fillRect(0, 0, cols, rows);
    }
    schedule(delay) {
      clearTimeout(this.timer);
      const ms = delay != null ? delay : this.num('interval', 240) * 1000 * (0.85 + Math.random() * 0.3);
      this.timer = setTimeout(() => { if (!document.hidden && !this.reduced) this.shoot(); this.schedule(); }, ms);
    }
    shoot() {
      const dir = Math.random() < 0.5 ? -1 : 1;
      this.shot = { x0: this.W * (0.2 + Math.random() * 0.6) | 0, y0: this.H * (0.05 + Math.random() * 0.35) | 0, dx: dir * 2, dy: Math.random() < 0.5 ? 2 : 1, len: 34 + (Math.random() * 16 | 0), tail: 12, t0: performance.now() };
    }
    drawShot(ctx, now) {
      const s = this.shot; if (!s) return;
      const step = Math.floor((now - s.t0) / 33);
      if (step > s.len + s.tail) { this.shot = null; return; }
      const unit = Math.max(Math.abs(s.dx), s.dy), pts = [];
      for (let k = 0; k <= step * unit && k <= s.len * unit; k++) pts.push([s.x0 + Math.round(k * s.dx / unit), s.y0 + Math.round(k * s.dy / unit)]);
      const fade = Math.max(0, step - s.len), cols = [PAL.white, PAL.white, PAL.cyan, PAL.cyan, PAL.blue, PAL.blue, PAL.dim2, PAL.dim2, PAL.dim];
      const tailPx = Math.max(0, (s.tail - fade) * unit);
      for (let i = 0; i < Math.min(tailPx, pts.length); i++) {
        const [x, y] = pts[pts.length - 1 - i];
        ctx.fillStyle = cols[Math.min(cols.length - 1, Math.floor(i / (s.tail * unit) * cols.length))]; ctx.fillRect(x, y, 1, 1);
      }
      if (!fade && pts.length) { const [x, y] = pts[pts.length - 1]; ctx.fillStyle = PAL.cyan; ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
    }
    drawTwinkle(ctx, s, f) {
      const put = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
      for (let ox = s.x; ox < this.W + 8; ox += this.TW) for (let oy = s.y; oy < this.H + 8; oy += this.TH) {
        const L = (s.big ? s.L : 1) + f; put(ox, oy, PAL.white);
        for (let k = 1; k <= L; k++) { const c = k <= f ? PAL.white : k === L ? PAL.blue : PAL[s.h]; put(ox + k, oy, c); put(ox - k, oy, c); put(ox, oy + k, c); put(ox, oy - k, c); }
        if (f >= 2) [[1, 1], [-1, -1], [1, -1], [-1, 1]].forEach(([a, b]) => put(ox + a, oy + b, PAL[s.h]));
      }
    }
    loop = now => {
      this.raf = requestAnimationFrame(this.loop);
      if (now - (this.last || 0) < (this.shot ? 30 : 110)) return;
      this.last = now;
      const ctx = this.fx.getContext('2d'); ctx.clearRect(0, 0, this.W, this.H);
      if (this.getAttribute('twinkle') !== 'false' && !this.reduced) {
        const t = now / 1000;
        for (const s of this.tw) { const ph = (t + s.off) % s.period; if (ph <= 1.1) this.drawTwinkle(ctx, s, [1, 2, 3, 2, 1][Math.min(4, Math.floor(ph / 0.22))]); }
      }
      this.drawShot(ctx, now);
    };
  }
  if (!customElements.get('starfield-8bit')) customElements.define('starfield-8bit', Starfield8bit);
})();
