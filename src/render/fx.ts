// 손맛 연출: 파티클, 화면 흔들림, 히트스톱, 줌 펀치, 섬광, 팝업 글자. 판정에 영향을 주지 않는다(6.3).
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { FxTextures } from './art';

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  spin: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  a0: number;
  flutter: number;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  vy: number;
}

const MAX_PARTICLES = 420;

export const PALETTE = [0xff8fb1, 0xffd166, 0x7ad7c4, 0x9ab8ff, 0xc9a2ff, 0xffffff, 0xffa36c];

export class Fx {
  readonly layer = new Container();
  readonly top = new Container();
  private readonly pool: Particle[] = [];
  private readonly live: Particle[] = [];
  private readonly popups: Popup[] = [];
  private readonly textPool: Text[] = [];
  private readonly flash = new Graphics();
  private flashLife = 0;
  private flashMax = 1;
  private trauma = 0;
  private punch = 0;
  private hitstopMs = 0;
  private slowMs = 0;
  private slowScale = 1;
  private t = 0;
  enabled = true;
  /** 회귀 테스트·성능 측정용 누적 스폰 수 */
  spawned = 0;

  constructor(
    readonly tex: FxTextures,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.flash.rect(-50, -50, w + 100, h + 100).fill(0xffffff);
    this.flash.alpha = 0;
    this.top.addChild(this.flash);
  }

  private get(): Particle | null {
    if (this.live.length >= MAX_PARTICLES) return null;
    const p = this.pool.pop() ?? {
      s: new Sprite(),
      vx: 0,
      vy: 0,
      g: 0,
      drag: 0,
      spin: 0,
      life: 0,
      max: 1,
      s0: 1,
      s1: 0,
      a0: 1,
      flutter: 0,
    };
    p.s.anchor.set(0.5);
    p.s.visible = true;
    this.layer.addChild(p.s);
    this.live.push(p);
    this.spawned++;
    return p;
  }

  emit(o: {
    x: number;
    y: number;
    tex: Texture;
    n: number;
    speed: [number, number];
    angle?: number;
    spread?: number;
    life: [number, number];
    scale: [number, number];
    endScale?: number;
    gravity?: number;
    drag?: number;
    tint?: number | number[];
    alpha?: number;
    spin?: number;
    flutter?: number;
    blend?: 'add' | 'normal';
  }): void {
    if (!this.enabled) return;
    for (let i = 0; i < o.n; i++) {
      const p = this.get();
      if (!p) return;
      const a = (o.angle ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      p.s.texture = o.tex;
      p.s.position.set(o.x, o.y);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.g = o.gravity ?? 0;
      p.drag = o.drag ?? 0;
      p.spin = (Math.random() - 0.5) * (o.spin ?? 0);
      p.max = p.life = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      p.s0 = o.scale[0] + Math.random() * (o.scale[1] - o.scale[0]);
      p.s1 = p.s0 * (o.endScale ?? 0);
      p.a0 = o.alpha ?? 1;
      p.flutter = o.flutter ?? 0;
      const tint = Array.isArray(o.tint) ? o.tint[Math.floor(Math.random() * o.tint.length)]! : o.tint ?? 0xffffff;
      p.s.tint = tint;
      p.s.rotation = Math.random() * Math.PI * 2;
      p.s.blendMode = o.blend === 'add' ? 'add' : 'normal';
      p.s.scale.set(p.s0);
      p.s.alpha = p.a0;
    }
  }

  popup(x: number, y: number, text: string, color = 0xffffff, size = 22): void {
    if (!this.enabled) return;
    const t = this.textPool.pop() ?? new Text({
      text,
      style: {
        fontFamily: 'Fredoka, Pretendard Variable, sans-serif',
        fontWeight: '700',
        fontSize: size,
        fill: color,
        stroke: { color: 0x5b3a6e, width: 5, join: 'round' },
        dropShadow: { color: 0x000000, alpha: 0.25, blur: 2, distance: 2, angle: Math.PI / 2 },
      },
    });
    t.text = text;
    t.style.fill = color;
    t.style.fontSize = size;
    t.visible = true;
    t.alpha = 1;
    t.anchor.set(0.5);
    t.position.set(x, y);
    t.scale.set(0.2);
    this.top.addChild(t);
    this.popups.push({ t, life: 0.9, max: 0.9, vy: -55 });
  }

  private releaseText(t: Text): void {
    t.visible = false;
    this.top.removeChild(t);
    if (this.textPool.length < 12) this.textPool.push(t);
    else t.destroy();
  }

  shake(amount: number): void {
    if (!this.enabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }
  zoomPunch(amount: number): void {
    if (!this.enabled) return;
    this.punch = Math.min(0.12, this.punch + amount);
  }
  hitstop(ms: number): void {
    if (!this.enabled) return;
    this.hitstopMs = Math.max(this.hitstopMs, ms);
  }
  slowmo(ms: number, scale: number): void {
    if (!this.enabled) return;
    this.slowMs = ms;
    this.slowScale = scale;
  }
  flashScreen(alpha: number, sec = 0.18): void {
    if (!this.enabled) return;
    this.flash.alpha = alpha;
    this.flashLife = this.flashMax = sec;
  }

  /** 시뮬레이션 시간 배율(히트스톱 0, 슬로모션 <1). 연출 전용이며 물리 단계 크기는 바뀌지 않는다 */
  timeScale(): number {
    if (this.hitstopMs > 0) return 0;
    if (this.slowMs > 0) return this.slowScale;
    return 1;
  }

  clear(): void {
    for (const p of this.live) {
      p.s.visible = false;
      this.pool.push(p);
    }
    this.live.length = 0;
    for (const p of this.popups) this.releaseText(p.t);
    this.popups.length = 0;
    this.trauma = 0;
    this.punch = 0;
    this.hitstopMs = 0;
    this.slowMs = 0;
    this.flash.alpha = 0;
  }

  /** 카메라 오프셋(흔들림)과 줌 */
  camera(): { dx: number; dy: number; rot: number; zoom: number } {
    const s = this.trauma * this.trauma;
    const n = (k: number) => Math.sin(this.t * 61.3 + k) * 0.6 + Math.sin(this.t * 97.1 + k * 3) * 0.4;
    return { dx: n(1) * 14 * s, dy: n(2) * 14 * s, rot: n(3) * 0.02 * s, zoom: 1 + this.punch };
  }

  update(dt: number): void {
    this.t += dt;
    this.hitstopMs = Math.max(0, this.hitstopMs - dt * 1000);
    this.slowMs = Math.max(0, this.slowMs - dt * 1000);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.punch *= Math.exp(-dt * 9);
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.alpha = Math.max(0, (this.flashLife / this.flashMax) * this.flash.alpha);
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        this.layer.removeChild(p.s);
        this.pool.push(p);
        this.live.splice(i, 1);
        continue;
      }
      const k = 1 - p.life / p.max;
      p.vy += p.g * dt;
      const dmp = Math.exp(-p.drag * dt);
      p.vx *= dmp;
      p.vy *= dmp;
      p.s.x += p.vx * dt + (p.flutter ? Math.sin(this.t * 9 + p.max * 40) * p.flutter * dt : 0);
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      const sc = p.s0 + (p.s1 - p.s0) * k;
      p.s.scale.set(p.flutter ? sc * Math.abs(Math.sin(this.t * 7 + p.max * 30)) + 0.05 : sc, sc);
      p.s.alpha = p.a0 * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      const pop = k < 0.18 ? easeOutBack(k / 0.18) : 1;
      p.t.scale.set(pop);
      p.t.y += p.vy * dt * (k > 0.25 ? 1 : 0.2);
      p.t.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      if (p.life <= 0) {
        this.releaseText(p.t);
        this.popups.splice(i, 1);
      }
    }
  }

  get count(): number {
    return this.live.length;
  }
  get size(): [number, number] {
    return [this.w, this.h];
  }
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutElastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}
