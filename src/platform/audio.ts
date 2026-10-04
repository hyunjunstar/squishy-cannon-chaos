// Web Audio 합성 효과음. 파일 없이 즉시 재생, 동시 재생 수를 제한한다(6.1 사운드).
// 모바일 자동재생 제한: 첫 터치에서 unlock()으로 잠금 해제(6.8).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = true;
const lastPlay = new Map<string, number>();

export function setSound(on: boolean): void {
  enabled = on;
}

export function unlock(): void {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let s = 1;
      for (let i = 0; i < d.length; i++) {
        s = (s * 16807) % 2147483647;
        d[i] = (s / 2147483647) * 2 - 1;
      }
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function suspendAudio(): void {
  void ctx?.suspend();
}

/** 같은 소리가 너무 촘촘히 겹치지 않게(동시 재생 관리) */
function gate(key: string, minMs: number): boolean {
  if (!ctx || !master || !enabled) return false;
  const now = ctx.currentTime * 1000;
  if (now - (lastPlay.get(key) ?? -1e9) < minMs) return false;
  lastPlay.set(key, now);
  return true;
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, curve: 'exp' | 'lin' = 'exp'): void {
  const c = ctx!;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  else o.frequency.linearRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, delay = 0, q = 0.8): void {
  const c = ctx!;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function wobble(f0: number, f1: number, dur: number, vol: number, rate: number, depth: number): void {
  const c = ctx!;
  const t = c.currentTime;
  const o = c.createOscillator();
  const lfo = c.createOscillator();
  const lg = c.createGain();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
  o.frequency.exponentialRampToValueAtTime(f1 * 0.8, t + dur);
  lfo.frequency.value = rate;
  lg.gain.value = depth;
  lfo.connect(lg).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  lfo.start(t);
  o.stop(t + dur + 0.02);
  lfo.stop(t + dur + 0.02);
}

export const sfx = {
  fire(): void {
    if (!gate('fire', 80)) return;
    tone('sine', 190, 48, 0.32, 0.9);
    noise(0.22, 0.6, 'lowpass', 900);
    tone('triangle', 520, 260, 0.09, 0.25, 0.01);
  },
  bounce(impulse: number): void {
    if (!gate('bounce', 45)) return;
    const k = Math.min(1, impulse / 8);
    tone('triangle', 240 + k * 80, 420 + k * 160, 0.12, 0.12 + k * 0.4);
    noise(0.05, 0.1 + k * 0.3, 'bandpass', 1400, 0, 1.2);
  },
  bumper(): void {
    if (!gate('bumper', 60)) return;
    wobble(180, 640, 0.42, 0.55, 26, 60);
  },
  targetHit(): void {
    if (!gate('thit', 50)) return;
    noise(0.04, 0.5, 'bandpass', 2600, 0, 2);
    tone('sine', 880, 620, 0.08, 0.3);
  },
  targetDown(combo: number): void {
    if (!gate('tdown', 30)) return;
    const base = 523.25 * Math.pow(2, Math.min(combo, 8) / 12 * 2);
    noise(0.12, 0.5, 'highpass', 1800);
    tone('square', base, base, 0.12, 0.12, 0.03, 'lin');
    tone('triangle', base * 1.5, base * 1.5, 0.22, 0.28, 0.08, 'lin');
    tone('sine', base * 2, base * 2.02, 0.35, 0.18, 0.12, 'lin');
  },
  ring(): void {
    if (!gate('ring', 100)) return;
    [1318, 1760, 2637].forEach((f, i) => tone('sine', f, f, 0.3, 0.2, i * 0.05, 'lin'));
  },
  win(): void {
    if (!gate('win', 500)) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      tone('triangle', f, f, 0.28, 0.32, i * 0.085, 'lin');
      tone('sine', f * 2, f * 2, 0.2, 0.08, i * 0.085, 'lin');
    });
    noise(0.8, 0.12, 'highpass', 6000, 0.35);
  },
  fail(): void {
    if (!gate('fail', 500)) return;
    tone('triangle', 392, 370, 0.22, 0.25, 0, 'lin');
    tone('triangle', 311, 290, 0.35, 0.25, 0.2, 'lin');
  },
  click(): void {
    if (!gate('click', 30)) return;
    tone('sine', 900, 1300, 0.06, 0.18);
  },
  pick(): void {
    if (!gate('pick', 30)) return;
    tone('triangle', 500, 760, 0.08, 0.2);
  },
  drop(ok: boolean): void {
    if (!gate('drop', 30)) return;
    if (ok) tone('sine', 700, 380, 0.1, 0.25);
    else tone('square', 200, 150, 0.14, 0.12);
  },
  tick(): void {
    if (!gate('tick', 40)) return;
    tone('sine', 1500, 1500, 0.03, 0.06, 0, 'lin');
  },
  warn(): void {
    if (!gate('warn', 300)) return;
    [0, 0.18, 0.36].forEach((d) => tone('square', 880, 880, 0.08, 0.08, d, 'lin'));
  },
  star(i: number): void {
    if (!gate('star' + i, 50)) return;
    const f = [784, 988, 1175][i] ?? 1175;
    tone('triangle', f, f * 1.01, 0.3, 0.3, 0, 'lin');
    noise(0.2, 0.1, 'highpass', 5000);
  },
  whoosh(): void {
    if (!gate('whoosh', 100)) return;
    noise(0.25, 0.25, 'bandpass', 700, 0, 0.6);
  },
};
