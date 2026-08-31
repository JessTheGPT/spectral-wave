# Spectral Wave

Build this: Apple's SIRI GLOW — the ribbon of light that ripples across the screen while Siri listens — rebuilt live in WebGL and driven by a real microphone. THE WHOLE LOOK IS ONE IDEA: draw the SAME sine wave FOUR TIMES in four spectral colours, each copy PHASE-SHIFTED by a different amount (-spread..+spread across the four samples). Where the wave is flat the four copies sit on top of each other and sum to white; where it bends hard the phase offset pushes them apart and the edge SPLITS INTO A RAINBOW — the way a prism separates light passing through it at an angle. The spectral ramp is a cheap wavelength->RGB: sample 0 lands red, 3 lands blue, 1/2 fill in green, so summing all four is neutral. DRAW EACH COPY AS A LORENTZIAN LINE, not a stroke: intensity = k / (sqrt(d*d + soft*soft) + thickness), where d is the vertical distance to that copy's curve. That 1/d falloff gives a tight bright core and a tail that never quite reaches zero, which is what makes it read as EMITTED LIGHT rather than a painted line (a gaussian falls off too fast and looks airbrushed; a hard line has no glow at all). Between the main un-shifted wave and each offset copy, also fill a BAND (k / (distance-outside-the-pair + eps)) so the ribbon has a lit body instead of reading as four separate wires. Sum the four, divide by the summed hue to keep the centre neutral, then raise the result to ~1.45 to push the dim tail down and the core up. Taper with a cos^2 envelope along x and a smoothstep fade toward the top/bottom so it reads as a contained ribbon, not a sine running off the canvas. DRIVE IT WITH SOUND: three frequency bands — low sets how far the wave swings, high sets how far the colours separate (so a vowel makes it bloom and an 's' makes it fringe), overall level sets brightness. Read them from a WebAudio AnalyserNode, and group the FFT bins BY FREQUENCY (roughly 60-320 / 320-1600 / 1600-6000 Hz), NOT by even thirds of the array — an FFT is linear in Hz but hearing is logarithmic, so an even split dumps nearly everything into 'high' and the wave barely moves on a voice. Smooth each band with an ASYMMETRIC envelope follower (fast attack, slow release) so it snaps open on a syllable and eases back instead of jittering per frame. Fall back to a simulated signal (layered sines at incommensurate rates, so it never visibly loops) when there is no microphone, so the card always has something to show; nothing is recorded or transmitted. ON A LIGHT BACKGROUND, COMPOSITE SUBTRACTIVELY: the original renders on black where the wave IS the light and you show it directly, but adding light to white paper blows straight out and the wave disappears — so treat the intensity as pigment DENSITY (how much light the ribbon removes) and its normalised hue as which wavelengths survive, giving paper * (1 - density * (1 - hue*0.55)). Same dispersion, legible on white. Framework-free WebGL2 (one fragment shader, one full-screen triangle, no geometry or framebuffers) + a rAF loop; DPR-capped at 2, pauses offscreen / when hidden / during route transitions, dithered output against banding on the wide soft gradients, and one composed static frame under reduced motion.

The complete, self-contained implementation follows, one file per block. It is framework-agnostic core logic — wire it into your own component and mount it on an element.

### siri-wave/shaders.ts

```ts

export const VERT = `#version 300 es

void main(){

  vec2 v = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);

  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);

}`;

export const FRAG = `#version 300 es

precision highp float;

uniform vec2  uRes;

uniform float uTime;

uniform float uLow;

uniform float uMid;

uniform float uHigh;

uniform float uLevel;

uniform float uPresence;

uniform float uWake;

uniform float uWakeLag;

uniform vec3  uPaper;

uniform float uDark;

out vec4 outColor;

const float PI = 3.14159265359;

vec3 spectral4(int s){

  vec3 c0 = vec3(0.26, 0.18, 1.00);

  vec3 c1 = vec3(0.74, 0.17, 0.96);

  vec3 c2 = vec3(1.00, 0.22, 0.52);

  vec3 c3 = vec3(1.00, 0.66, 0.22);

  return s == 0 ? c0 : s == 1 ? c1 : s == 2 ? c2 : c3;

}

float waveY(float x, float amp, float env, float drift, float harm){

  float fundamental = sin(x * 1.1 + drift);

  float partial = sin(x * 2.53 + drift * 1.6 + 1.7);

  float tilt = 1.0 + 0.14 * sin(x * 0.42 - drift * 0.6);

  return amp * env * tilt * (fundamental + harm * partial);

}

float thicknessAt(float xN, float uMid){

  float taper = 1.0 - 0.55 * clamp(abs(xN) * 0.75, 0.0, 1.0);

  return (0.020 + 0.016 * taper) * (1.0 + 0.35 * uMid);

}

vec3 ribbon(vec2 p, float aspect, float amp, float spread, float drift,

            float harm, float uMid, float uLevel, float soften){

  float xN  = p.x / max(aspect, 1.0);

  float env = cos(PI * 0.5 * min(abs(0.92 * xN), 1.0));

  env *= env;

  float thick = thicknessAt(xN, uMid) * soften;

  float soft  = (0.020 + 0.012 * uMid) * soften;

  float inten = 0.019 * (1.0 + 0.7 * uLevel);

  float yMain = waveY(p.x, amp, env, drift, harm);

  vec3 num = vec3(0.0), den = vec3(0.0);

  for (int s = 0; s < 4; s++){

    vec3 hue = spectral4(s);

    den += hue;

    float ab = mix(-spread, spread, float(s) / 3.0);

    float yL = waveY(p.x, amp + 0.03 * uMid, env, drift + ab, harm);

    float d    = abs(p.y - yL);

    float line = inten / (sqrt(d * d + soft * soft) + thick);

    line *= exp(-d * d);

    float lo = min(yMain, yL), hi = max(yMain, yL);

    float dB = max(0.0, max(p.y - hi, lo - p.y));

    float band = 4.9 * inten * exp(-dB / (0.08 * soften));

    num += hue * (line + band);

  }

  float denS = (den.r + den.g + den.b) / 3.0;

  vec3 col = num / max(denS, 1e-5);

  float dM = abs(p.y - yMain);

  col += 0.42 * inten / (sqrt(dM * dM + soft * soft) + thick);

  return col;

}

float hash21(vec2 p){

  p = fract(p * vec2(123.34, 456.21));

  p += dot(p, p + 45.32);

  return fract(p.x * p.y);

}

void main(){

  vec2 R = uRes;

  float aspect = R.x / R.y;

  vec2 p = (gl_FragCoord.xy + 0.5) * 2.0 / R - 1.0;

  p.x *= aspect;

  float yScreen = p.y;

  p /= 0.62;

  float t = uTime;

  float wake = clamp(uWake, 0.0, 1.0);

  float rest = 1.0 - wake;

  float idleBreath = 0.030 + 0.016 * sin(t * 0.9) * sin(t * 0.41 + 1.0);

  float amp    = mix(idleBreath, 0.20 + 0.34 * uLow, wake) * uPresence;

  float lag    = clamp(uWakeLag, 0.0, 1.0);

  float spread = mix(0.55, 2.2 + 1.6 * uHigh + 0.6 * uMid, lag) * uPresence;

  float harm   = mix(0.10, 0.34 + 0.22 * uHigh, wake);

  float xN    = p.x / max(aspect, 1.0);

  float drift = t * mix(0.9, 2.1, wake);

  float ends  = exp(-pow(xN * 1.55, 2.0));

  vec3 col = ribbon(p, aspect, amp, spread, drift, harm, uMid, uLevel, 1.0);

  const float SURFACE = 0.50;

  vec2 rp = vec2(p.x, 2.0 * SURFACE - p.y);

  vec3 refl = ribbon(rp, aspect, amp * 0.86, spread, drift, harm, uMid, uLevel, 2.1);

  float underSurface = smoothstep(0.0, 0.16, p.y - SURFACE);

  float depth = clamp((p.y - SURFACE) / 0.95, 0.0, 1.0);

  col += refl * 0.52 * underSurface * (1.0 - depth) * (1.0 - depth);

  col = pow(max(col, 0.0), vec3(1.45));

  float above = smoothstep(1.0, 0.34, -yScreen);

  float below = smoothstep(1.06, 0.52, yScreen);

  float edge  = yScreen < 0.0 ? above : below;

  col *= edge * ends * uPresence;

  vec3 outc;

  if (uDark > 0.5) {

    outc = col;

  } else {

    float dens = clamp(max(max(col.r, col.g), col.b) * 1.9, 0.0, 1.0);

    vec3 hue = col / max(max(max(col.r, col.g), col.b), 1e-6);

    outc = uPaper * (1.0 - dens * (1.0 - hue * 0.55));

    outc = clamp(outc, 0.0, 1.0);

  }

  float g = hash21(gl_FragCoord.xy * 0.75 + fract(uTime) * 91.7);

  vec3 sl = outc * (1.0 - 2.0 * (g - 0.5) * outc) + (2.0 * (g - 0.5)) * sqrt(max(outc, 0.0));

  outc = mix(outc, clamp(sl, 0.0, 1.0), 0.055);

  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

  outc += (n - 0.5) / 255.0;

  outColor = vec4(outc, 1.0);

}`;

```

### siri-wave/audio.ts

```ts

export interface Bands {

  low: number;

  mid: number;

  high: number;

  level: number;

}

const PHRASES: { speak: number; pause: number; force: number }[] = [

  { speak: 2.6, pause: 1.5, force: 0.85 },

  { speak: 1.3, pause: 0.9, force: 0.55 },

  { speak: 3.9, pause: 2.1, force: 1.0 },

  { speak: 1.8, pause: 1.2, force: 0.7 },

  { speak: 3.1, pause: 2.6, force: 0.9 },

  { speak: 1.1, pause: 1.7, force: 0.45 },

];

function phraseEnvelope(u: number): number {

  if (u <= 0 || u >= 1) return 0;

  const attack = Math.min(1, u / 0.18);

  const release = Math.min(1, (1 - u) / 0.55);

  const a = attack * attack * (3 - 2 * attack);

  const r = release * release * (3 - 2 * release);

  return a * r;

}

function follow(current: number, target: number, dt: number, attack: number, release: number) {

  const rate = target > current ? attack : release;

  return current + (target - current) * Math.min(1, dt * rate);

}

export class SignalSource {

  private bands: Bands = { low: 0, mid: 0, high: 0, level: 0 };

  private clock = 0;

  private phraseIdx = 0;

  private phraseT = 0;

  private phraseEnv = 0;

  get envelope() {

    return this.phraseEnv;

  }

  private phrase(dt: number): number {

    this.phraseT += dt;

    const p = PHRASES[this.phraseIdx % PHRASES.length];

    const total = p.speak + p.pause;

    if (this.phraseT >= total) {

      this.phraseT -= total;

      this.phraseIdx = (this.phraseIdx + 1) % PHRASES.length;

    }

    const cur = PHRASES[this.phraseIdx % PHRASES.length];

    const u = this.phraseT / cur.speak;

    this.phraseEnv = u >= 1 ? 0 : phraseEnvelope(u) * cur.force;

    return this.phraseEnv;

  }

  private ctx: AudioContext | null = null;

  private analyser: AnalyserNode | null = null;

  private stream: MediaStream | null = null;

  private freq: Uint8Array<ArrayBuffer> | null = null;

  private binHz = 0;

  get live() {

    return !!this.analyser;

  }

  async enableMic(): Promise<boolean> {

    if (this.analyser) return true;

    if (!navigator.mediaDevices?.getUserMedia) return false;

    try {

      const stream = await navigator.mediaDevices.getUserMedia({

        audio: {

          echoCancellation: true,

          noiseSuppression: true,

          autoGainControl: true,

        },

      });

      type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

      const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;

      if (!Ctor) {

        stream.getTracks().forEach((t) => t.stop());

        return false;

      }

      const ctx = new Ctor();

      if (ctx.state === "suspended") await ctx.resume();

      const analyser = ctx.createAnalyser();

      analyser.fftSize = 1024;

      analyser.smoothingTimeConstant = 0.86;

      ctx.createMediaStreamSource(stream).connect(analyser);

      this.ctx = ctx;

      this.stream = stream;

      this.analyser = analyser;

      this.freq = new Uint8Array(analyser.frequencyBinCount);

      this.binHz = ctx.sampleRate / analyser.fftSize;

      return true;

    } catch {

      return false;

    }

  }

  disableMic() {

    this.stream?.getTracks().forEach((t) => t.stop());

    this.ctx?.close().catch(() => {});

    this.stream = null;

    this.ctx = null;

    this.analyser = null;

    this.freq = null;

  }

  private bin(loHz: number, hiHz: number): number {

    const f = this.freq;

    if (!f || !this.binHz) return 0;

    const a = Math.max(0, Math.floor(loHz / this.binHz));

    const b = Math.min(f.length, Math.ceil(hiHz / this.binHz));

    if (b <= a) return 0;

    let sum = 0;

    for (let i = a; i < b; i++) sum += f[i];

    return sum / (b - a) / 255;

  }

  read(dt: number): Bands {

    this.clock += dt;

    const b = this.bands;

    if (this.analyser && this.freq) {

      this.analyser.getByteFrequencyData(this.freq);

      const low = this.bin(60, 320);

      const mid = this.bin(320, 1600);

      const high = this.bin(1600, 6000);

      const g = (v: number) => {

        const x = v * 2.3;

        return x / (1 + x * 0.55);

      };

      b.low = follow(b.low, g(low), dt, 9, 3.5);

      b.mid = follow(b.mid, g(mid), dt, 10, 4);

      b.high = follow(b.high, g(high), dt, 11, 4.5);

      b.level = follow(b.level, g((low + mid + high) * 0.65), dt, 8, 3);

      return b;

    }

    const t = this.clock;

    const env = this.phrase(dt);

    const shapeLow = env;

    const shapeMid = Math.pow(env, 0.85);

    const shapeHigh = Math.pow(env, 1.35);

    const low = (0.45 + 0.45 * Math.sin(t * 0.8) * Math.sin(t * 0.37 + 1.0)) * shapeLow;

    const mid = (0.40 + 0.40 * Math.sin(t * 1.7 + 2.0) * Math.sin(t * 0.53)) * shapeMid;

    const high = (0.30 + 0.30 * Math.sin(t * 2.9 + 4.0) * Math.sin(t * 0.71 + 2.0)) * shapeHigh;

    b.low = follow(b.low, Math.max(0, low), dt, 10, 6);

    b.mid = follow(b.mid, Math.max(0, mid), dt, 12, 7);

    b.high = follow(b.high, Math.max(0, high), dt, 14, 8);

    b.level = follow(b.level, Math.max(0, (low + mid + high) / 2.4), dt, 10, 5);

    return b;

  }

  destroy() {

    this.disableMic();

  }

}

```

### siri-wave/engine.ts

```ts

import { VERT, FRAG } from "./shaders";

import { SignalSource } from "./audio";

function cssColor(el: HTMLElement, name: string, fallback: [number, number, number]) {

  const raw = getComputedStyle(el).getPropertyValue(name).trim();

  if (!raw) return fallback;

  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

  if (hex) {

    const h = hex[1];

    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;

    const n = parseInt(full, 16);

    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as [number, number, number];

  }

  const rgb = raw.match(/rgba?\(([^)]+)\)/i);

  if (rgb) {

    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);

    if (parts.length >= 3 && parts.every((v) => !Number.isNaN(v))) {

      return [parts[0] / 255, parts[1] / 255, parts[2] / 255] as [number, number, number];

    }

  }

  return fallback;

}

export class SiriWave {

  private host: HTMLElement;

  private canvas: HTMLCanvasElement;

  private gl: WebGL2RenderingContext | null = null;

  private prog: WebGLProgram | null = null;

  private u: Record<string, WebGLUniformLocation | null> = {};

  readonly signal = new SignalSource();

  private raf = 0;

  private last = 0;

  private running = false;

  private dpr = 1;

  private ro: ResizeObserver | null = null;

  private disposed = false;

  private presence = 0;

  private presenceTarget = 1;

  private wake = 0;

  private wakeLag = 0;

  constructor(host: HTMLElement) {

    this.host = host;

    this.canvas = document.createElement("canvas");

    this.canvas.style.cssText = "display:block;width:100%;height:100%";

    host.appendChild(this.canvas);

    const gl = this.canvas.getContext("webgl2", {

      antialias: false,

      alpha: false,

      powerPreference: "low-power",

    });

    if (!gl) return;

    this.gl = gl;

    const prog = this.build(gl);

    if (!prog) return;

    this.prog = prog;

    gl.useProgram(prog);

    for (const n of ["uRes", "uTime", "uLow", "uMid", "uHigh", "uLevel", "uPresence", "uWake", "uWakeLag", "uPaper", "uDark"]) {

      this.u[n] = gl.getUniformLocation(prog, n);

    }

    this.pushPalette();

    this.resize();

    this.ro = new ResizeObserver(() => this.resize());

    this.ro.observe(host);

  }

  get ok() {

    return !!this.gl && !!this.prog;

  }

  private build(gl: WebGL2RenderingContext): WebGLProgram | null {

    const compile = (type: number, src: string) => {

      const s = gl.createShader(type)!;

      gl.shaderSource(s, src);

      gl.compileShader(s);

      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {

        if (process.env.NODE_ENV !== "production") {

          console.error("[siri-wave]", gl.getShaderInfoLog(s));

        }

        gl.deleteShader(s);

        return null;

      }

      return s;

    };

    const vs = compile(gl.VERTEX_SHADER, VERT);

    const fs = compile(gl.FRAGMENT_SHADER, FRAG);

    if (!vs || !fs) return null;

    const p = gl.createProgram()!;

    gl.attachShader(p, vs);

    gl.attachShader(p, fs);

    gl.linkProgram(p);

    gl.deleteShader(vs);

    gl.deleteShader(fs);

    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {

      if (process.env.NODE_ENV !== "production") {

        console.error("[siri-wave]", gl.getProgramInfoLog(p));

      }

      gl.deleteProgram(p);

      return null;

    }

    return p;

  }

  private pushPalette() {

    const gl = this.gl;

    if (!gl) return;

    const paper = cssColor(this.host, "--bg-surface", [1, 1, 1]);

    gl.uniform3fv(this.u.uPaper!, paper);

    gl.uniform1f(this.u.uDark!, 0);

  }

  refreshPalette() {

    if (!this.gl || !this.prog) return;

    this.gl.useProgram(this.prog);

    this.pushPalette();

  }

  private resize() {

    const gl = this.gl;

    if (!gl || this.disposed) return;

    const w = this.host.clientWidth;

    const h = this.host.clientHeight;

    if (!w || !h) return;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    const bw = Math.round(w * this.dpr);

    const bh = Math.round(h * this.dpr);

    if (this.canvas.width !== bw || this.canvas.height !== bh) {

      this.canvas.width = bw;

      this.canvas.height = bh;

    }

    gl.viewport(0, 0, bw, bh);

    if (!this.running) this.draw(0);

  }

  async enableMic() {

    return this.signal.enableMic();

  }

  disableMic() {

    this.signal.disableMic();

  }

  get micLive() {

    return this.signal.live;

  }

  private draw(dt: number) {

    const gl = this.gl;

    if (!gl || !this.prog) return;

    const b = this.signal.read(dt);

    this.presence += (this.presenceTarget - this.presence) * Math.min(1, dt * 3);

    const target = this.signal.live

      ? Math.min(1, b.level * 1.35)

      : 0.12 + 0.88 * this.signal.envelope;

    const rate = target > this.wake ? 4.5 : 1.4;

    this.wake += (target - this.wake) * Math.min(1, dt * rate);

    this.wakeLag += (this.wake - this.wakeLag) * Math.min(1, dt * 8);

    gl.useProgram(this.prog);

    gl.uniform2f(this.u.uRes!, this.canvas.width, this.canvas.height);

    gl.uniform1f(this.u.uTime!, performance.now() / 1000);

    gl.uniform1f(this.u.uLow!, b.low);

    gl.uniform1f(this.u.uMid!, b.mid);

    gl.uniform1f(this.u.uHigh!, b.high);

    gl.uniform1f(this.u.uLevel!, b.level);

    gl.uniform1f(this.u.uPresence!, this.presence);

    gl.uniform1f(this.u.uWake!, this.wake);

    gl.uniform1f(this.u.uWakeLag!, this.wakeLag);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

  }

  renderStill() {

    this.presence = 1;

    this.wake = 0.82;

    this.wakeLag = 0.82;

    for (let i = 0; i < 60; i++) this.signal.read(1 / 60);

    this.draw(0);

  }

  start() {

    if (this.running || !this.ok || this.disposed) return;

    this.running = true;

    this.last = performance.now();

    const tick = (now: number) => {

      if (!this.running) return;

      const dt = Math.min((now - this.last) / 1000, 1 / 30);

      this.last = now;

      this.draw(dt);

      this.raf = requestAnimationFrame(tick);

    };

    this.raf = requestAnimationFrame(tick);

  }

  stop() {

    this.running = false;

    if (this.raf) cancelAnimationFrame(this.raf);

    this.raf = 0;

  }

  destroy() {

    this.disposed = true;

    this.stop();

    this.ro?.disconnect();

    this.ro = null;

    this.signal.destroy();

    const gl = this.gl;

    if (gl) {

      if (this.prog) gl.deleteProgram(this.prog);

      gl.getExtension("WEBGL_lose_context")?.loseContext();

    }

    this.prog = null;

    this.gl = null;

    this.canvas.remove();

  }

}

```

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e9ab5c70-becd-4273-8c61-70d10bf10c8a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
