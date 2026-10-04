// 성공 리플레이: 물리를 다시 돌리지 않고 기록한 위치·각도·이벤트를 재생(6.5).
// 표적이 쓰러지는 순간 앞뒤로 슬로모션을 걸어 손맛을 살린다.
import type { Replay, SimEvent } from '../core/types';

export interface ReplayFrameBody {
  id: string;
  kind: 'ball' | 'target';
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
}

export class ReplayPlayer {
  t = 0;
  private evIdx = 0;
  private hold = 0;
  loops = 0;
  private readonly slowSteps: number[];

  constructor(readonly replay: Replay) {
    this.slowSteps = replay.events.filter((e) => e.t === 'targetDown' || e.t === 'bumper' || e.t === 'ring').map((e) => e.step);
  }

  get length(): number {
    return this.replay.frames.length;
  }

  /** 현재 재생 속도 배율: 핵심 순간 근처는 느리게 */
  rate(): number {
    const s = this.t;
    let r = 1;
    for (const k of this.slowSteps) {
      const d = s - k;
      if (d > -14 && d < 22) r = Math.min(r, 0.32);
      else if (d > -26 && d < 34) r = Math.min(r, 0.6);
    }
    return r;
  }

  /** dt초 진행. 새로 지난 이벤트와 처음으로 돌아갔는지를 돌려준다 */
  update(dt: number): { events: SimEvent[]; restarted: boolean } {
    const out: SimEvent[] = [];
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.t = 0;
        this.evIdx = 0;
        this.loops++;
        return { events: out, restarted: true };
      }
      return { events: out, restarted: false };
    }
    this.t += dt * 60 * this.rate();
    const ev = this.replay.events;
    while (this.evIdx < ev.length && ev[this.evIdx]!.step <= this.t) out.push(ev[this.evIdx++]!);
    if (this.t >= this.length - 1) {
      this.t = this.length - 1;
      this.hold = 1.4;
    }
    return { events: out, restarted: false };
  }

  bodies(): ReplayFrameBody[] {
    const f = this.replay.frames;
    const i0 = Math.max(0, Math.min(f.length - 1, Math.floor(this.t)));
    const i1 = Math.min(f.length - 1, i0 + 1);
    const k = this.t - i0;
    const a = f[i0]!;
    const b = f[i1]!;
    const out: ReplayFrameBody[] = [];
    this.replay.bodies.forEach((m, j) => {
      const x0 = a[j * 3]!;
      if (Number.isNaN(x0)) return;
      const x1 = Number.isNaN(b[j * 3]!) ? x0 : b[j * 3]!;
      const y0 = a[j * 3 + 1]!;
      const y1 = Number.isNaN(b[j * 3 + 1]!) ? y0 : b[j * 3 + 1]!;
      const a0 = a[j * 3 + 2]!;
      const a1 = Number.isNaN(b[j * 3 + 2]!) ? a0 : b[j * 3 + 2]!;
      out.push({ id: m.id, kind: m.kind, x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, angle: a0 + (a1 - a0) * k, vx: (x1 - x0) * 60, vy: (y1 - y0) * 60 });
    });
    return out;
  }
}
