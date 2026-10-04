// 시뮬레이션 이벤트 → 연출·소리·진동. 실시간 플레이와 리플레이가 같은 연출을 쓴다.
import type { SimEvent } from '../core/types';
import { sfx } from '../platform/audio';
import { buzz } from '../platform/haptics';
import { PALETTE } from './fx';
import type { Fx } from './fx';
import { toPx } from './world_view';
import type { WorldView } from './world_view';

export interface DirectorHooks {
  onGoal?(done: number, total: number): void;
  onTimeWarning?(): void;
}

export class Director {
  private downs = 0;
  silent = false;

  constructor(
    private readonly view: WorldView,
    private readonly fx: Fx,
    private readonly totalGoals: number,
    private readonly hooks: DirectorHooks = {},
  ) {}

  reset(): void {
    this.downs = 0;
  }

  react(e: SimEvent): void {
    const fx = this.fx;
    const T = fx.tex;
    const s = this.silent;
    switch (e.t) {
      case 'fire': {
        const [x, y] = toPx(e.x, e.y);
        const ang = Math.atan2(-e.vy, e.vx);
        this.view.kickRecoil();
        fx.emit({ x, y, tex: T.soft, n: 1, speed: [0, 0], life: [0.14, 0.14], scale: [0.9, 0.9], endScale: 1.8, tint: 0xfff2b0, blend: 'add', alpha: 0.8 });
        fx.emit({ x, y, tex: T.streak, n: 10, angle: ang, spread: 0.9, speed: [260, 520], life: [0.12, 0.26], scale: [0.6, 1], endScale: 0.2, drag: 6, tint: [0xffe066, 0xffffff, 0xffa36c], blend: 'add' });
        fx.emit({ x, y, tex: T.puff, n: 6, angle: ang, spread: 1.4, speed: [30, 110], life: [0.5, 0.9], scale: [0.35, 0.6], endScale: 1.4, drag: 3, gravity: -40, tint: 0xf4ecff, alpha: 0.85 });
        fx.shake(0.32);
        fx.zoomPunch(0.025);
        this.view.squashBall(-0.3);
        if (!s) {
          sfx.fire();
          buzz(18);
        }
        break;
      }
      case 'hit': {
        const k = Math.min(1, e.impulse / 7);
        if (k < 0.08) break;
        const [x, y] = toPx(e.x, e.y);
        fx.emit({ x, y, tex: T.puff, n: 2 + Math.round(k * 4), speed: [20, 70 + k * 80], spread: Math.PI * 2, life: [0.3, 0.55], scale: [0.2, 0.3 + k * 0.2], endScale: 1.3, drag: 4, gravity: -20, tint: 0xffffff, alpha: 0.8 });
        fx.emit({ x, y, tex: T.ring, n: 1, speed: [0, 0], life: [0.22, 0.22], scale: [0.25, 0.25], endScale: 1.2 + k * 1.4, tint: 0xffffff, alpha: 0.75 });
        if (k > 0.35) fx.emit({ x, y, tex: T.star, n: Math.round(k * 5), speed: [80, 200], life: [0.3, 0.5], scale: [0.35, 0.6], endScale: 0, gravity: 300, spin: 10, tint: PALETTE });
        this.view.squashBall(0.15 + k * 0.25);
        fx.shake(0.06 + k * 0.22);
        if (k > 0.55) fx.hitstop(35 + k * 30);
        if (!s) {
          sfx.bounce(e.impulse);
          if (k > 0.4) buzz(10);
        }
        break;
      }
      case 'bumper': {
        const [x, y] = toPx(e.x, e.y);
        const ang = Math.atan2(-e.vy, e.vx);
        this.view.bumpBumper(e.id);
        fx.emit({ x, y, tex: T.ring, n: 2, speed: [0, 0], life: [0.28, 0.36], scale: [0.4, 0.5], endScale: 2.4, tint: 0xff7ab8, alpha: 0.9 });
        fx.emit({ x, y, tex: T.streak, n: 8, angle: ang + Math.PI, spread: 0.8, speed: [120, 260], life: [0.2, 0.32], scale: [0.6, 0.9], endScale: 0.2, drag: 4, tint: [0xff8fb1, 0xffffff], blend: 'add' });
        fx.popup(x, y - 22, '뿅!', 0xff8fb1, 20);
        fx.shake(0.18);
        fx.hitstop(45);
        if (!s) {
          sfx.bumper();
          buzz(14);
        }
        break;
      }
      case 'targetHit': {
        this.view.hitTarget(e.id);
        if (!s) sfx.targetHit();
        break;
      }
      case 'targetDown': {
        this.downs++;
        const [x, y] = toPx(e.x, e.y);
        this.view.downTarget(e.id);
        const last = this.downs >= this.totalGoals;
        fx.emit({ x, y, tex: T.soft, n: 1, speed: [0, 0], life: [0.2, 0.2], scale: [0.7, 0.7], endScale: 2.0, tint: 0xfff3b0, blend: 'add', alpha: 0.55 });
        fx.emit({ x, y, tex: T.confetti, n: last ? 34 : 22, angle: -Math.PI / 2, spread: Math.PI * 1.3, speed: [160, 380], life: [0.8, 1.4], scale: [0.6, 1.0], gravity: 520, drag: 2.2, spin: 14, flutter: 30, tint: PALETTE });
        fx.emit({ x, y, tex: T.star, n: 8, speed: [120, 260], life: [0.4, 0.7], scale: [0.5, 0.8], endScale: 0, drag: 3, spin: 8, tint: [0xffe066, 0xffffff] });
        fx.emit({ x, y, tex: T.ring, n: 1, speed: [0, 0], life: [0.35, 0.35], scale: [0.4, 0.4], endScale: 3, tint: 0xffe066, alpha: 0.9 });
        fx.popup(x, y - 40, this.totalGoals > 1 ? `${this.downs}/${this.totalGoals}` : '쿵!', 0xffe066, last ? 30 : 24);
        fx.shake(last ? 0.5 : 0.32);
        fx.zoomPunch(last ? 0.06 : 0.035);
        fx.hitstop(last ? 110 : 80);
        if (last) {
          fx.slowmo(650, 0.3);
          fx.flashScreen(0.35, 0.25);
        }
        this.hooks.onGoal?.(this.downs, this.totalGoals);
        if (!s) {
          sfx.targetDown(this.downs - 1);
          buzz(last ? 45 : 28);
        }
        break;
      }
      case 'ring': {
        const [x, y] = toPx(e.x, e.y);
        this.view.passRing();
        fx.emit({ x, y, tex: T.star, n: 16, speed: [100, 260], life: [0.5, 0.9], scale: [0.4, 0.8], endScale: 0, drag: 2, spin: 6, tint: [0xffe066, 0xfff7c2] });
        fx.emit({ x, y, tex: T.ring, n: 2, speed: [0, 0], life: [0.4, 0.5], scale: [0.8, 0.9], endScale: 2.2, tint: 0xffd34d });
        fx.popup(x, y - 34, '황금 링!', 0xffd34d, 20);
        if (!s) sfx.ring();
        break;
      }
      case 'ballLost':
        break;
      case 'timeWarning':
        this.hooks.onTimeWarning?.();
        if (!s) sfx.warn();
        break;
      case 'forbidden': {
        const [x, y] = toPx(e.x, e.y);
        fx.emit({ x, y, tex: T.ring, n: 3, speed: [0, 0], life: [0.4, 0.6], scale: [0.4, 0.5], endScale: 2.6, tint: 0xff5a5a });
        fx.shake(0.4);
        break;
      }
      case 'win': {
        const [w] = fx.size;
        for (let i = 0; i < 4; i++) {
          fx.emit({ x: (w / 5) * (i + 1), y: -20, tex: T.confetti, n: 22, angle: Math.PI / 2, spread: 1.0, speed: [60, 220], life: [1.6, 2.6], scale: [0.7, 1.1], gravity: 260, drag: 1.2, spin: 12, flutter: 40, tint: PALETTE });
        }
        if (!s) sfx.win();
        break;
      }
      case 'fail':
        if (!s) sfx.fail();
        break;
    }
  }
}
