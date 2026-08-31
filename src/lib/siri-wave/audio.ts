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

  const attack = Math.min(1, u / 0.34);

  const release = Math.min(1, (1 - u) / 0.7);

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

    const p = PHRASES[this.phraseIdx % PHRASES.length]!;

    const total = p.speak + p.pause;

    if (this.phraseT >= total) {

      this.phraseT -= total;

      this.phraseIdx = (this.phraseIdx + 1) % PHRASES.length;

    }

    const cur = PHRASES[this.phraseIdx % PHRASES.length]!;

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

      analyser.smoothingTimeConstant = 0.93;

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

  private saved: { analyser: AnalyserNode | null; freq: Uint8Array<ArrayBuffer> | null; binHz: number } | null = null;

  attachExternal(ctx: AudioContext, node: AudioNode) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.93;
    node.connect(analyser);
    this.saved = { analyser: this.analyser, freq: this.freq, binHz: this.binHz };
    this.analyser = analyser;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.binHz = ctx.sampleRate / analyser.fftSize;
  }

  detachExternal() {
    if (!this.saved) return;
    this.analyser = this.saved.analyser;
    this.freq = this.saved.freq;
    this.binHz = this.saved.binHz;
    this.saved = null;
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

    for (let i = a; i < b; i++) sum += f[i]!;

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

      b.low = follow(b.low, g(low), dt, 3.2, 1.6);

      b.mid = follow(b.mid, g(mid), dt, 3.4, 1.7);

      b.high = follow(b.high, g(high), dt, 3.6, 1.8);

      b.level = follow(b.level, g((low + mid + high) * 0.65), dt, 3.0, 1.4);

      return b;

    }

    const t = this.clock;

    const env = this.phrase(dt);

    const shapeLow = env;

    const shapeMid = Math.pow(env, 0.85);

    const shapeHigh = Math.pow(env, 1.35);

    const low = (0.45 + 0.45 * Math.sin(t * 0.42) * Math.sin(t * 0.19 + 1.0)) * shapeLow;

    const mid = (0.40 + 0.40 * Math.sin(t * 0.72 + 2.0) * Math.sin(t * 0.27)) * shapeMid;

    const high = (0.30 + 0.30 * Math.sin(t * 1.05 + 4.0) * Math.sin(t * 0.33 + 2.0)) * shapeHigh;

    b.low = follow(b.low, Math.max(0, low), dt, 2.6, 1.6);

    b.mid = follow(b.mid, Math.max(0, mid), dt, 2.8, 1.7);

    b.high = follow(b.high, Math.max(0, high), dt, 3.0, 1.8);

    b.level = follow(b.level, Math.max(0, (low + mid + high) / 2.4), dt, 2.4, 1.4);

    return b;

  }

  destroy() {

    this.disableMic();

  }

}
