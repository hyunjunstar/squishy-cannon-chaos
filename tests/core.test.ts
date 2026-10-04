import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUMPER_SPEED, STEP_DT } from '../src/core/constants';
import { editProblems, snapRot, solutionEdit, validateLevel } from '../src/core/level';
import { previewPath } from '../src/core/preview';
import { FixedStepper } from '../src/core/runner';
import { Session } from '../src/core/session';
import { Simulation } from '../src/core/sim';
import { retryRestores, runEdit, runViaFrames } from '../src/core/verify';
import type { LevelData } from '../src/core/types';

const load = (name: string): LevelData => JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
const FIXTURES = ['bumper', 'ramp', 'ring', 'bell', 'double'].map(load);

describe('M1 테스트 레벨 5개: 정답 재현', () => {
  for (const level of FIXTURES) {
    it(`${level.levelId}: 정답 100회 성공 + 상태 해시 동일`, () => {
      expect(validateLevel(level)).toEqual([]);
      const sol = level.solutions[0]!;
      expect(sol).toBeDefined();
      let hash: string | null = null;
      for (let i = 0; i < 100; i++) {
        const sim = new Simulation(level, solutionEdit(sol));
        const r = sim.run();
        expect(r.status).toBe('win');
        const h = sim.stateHash();
        if (hash === null) hash = h;
        expect(h).toBe(hash);
      }
    });
    it(`${level.levelId}: 재배치 후 발사 직전 상태와 동일`, () => {
      expect(retryRestores(level, solutionEdit(level.solutions[0]!), 30)).toBe(true);
    });
    it(`${level.levelId}: 2배속·프레임 흔들림에도 결과 동일`, () => {
      const edit = solutionEdit(level.solutions[0]!);
      const a = runViaFrames(level, edit, 1, [1 / 60]);
      const b = runViaFrames(level, edit, 2, [1 / 60]);
      const c = runViaFrames(level, edit, 2, [1 / 30, 1 / 144, 1 / 50, 0.021]);
      expect(b.hash).toBe(a.hash);
      expect(c.hash).toBe(a.hash);
      expect(a.result.status).toBe('win');
    });
  }
});

describe('4장 규칙', () => {
  const bell = load('bell');
  it('보호 대상 접촉은 실패(금지 조건)이고 실패가 성공보다 우선', () => {
    const results = [];
    for (let a = 10; a <= 80; a++) results.push({ a, r: runEdit(bell, { cannonAngle: a, placements: [] }) });
    const forb = results.filter((x) => x.r.reason === 'forbidden');
    expect(forb.length).toBeGreaterThan(0);
    for (const f of forb) {
      expect(f.r.status).toBe('fail');
      expect(f.r.focus?.kind).toBe('forbidden');
    }
  });

  it('공이 빗나가면 정지 판정으로 실패하고 마지막 의미 있는 지점을 알려준다', () => {
    const ring = load('ring');
    const r = runEdit(ring, { cannonAngle: 45, placements: [] });
    expect(r.status).toBe('fail');
    expect(r.reason).toBe('stalled');
    expect(r.focus).toBeDefined();
  });

  it('최대 시뮬레이션 시간이 지나면 실패, 종료 3초 전 안내 이벤트', () => {
    const lvl: LevelData = { ...load('ring'), timeLimit: 4 };
    const sim = new Simulation(lvl, { cannonAngle: 80, placements: [] });
    // 공을 계속 움직이게 해 정지 판정이 나지 않게 한다
    const r = (() => {
      while (!sim.finished) {
        sim.stepOnce();
        const b = (sim as unknown as { ball: { setLinearVelocity(v: { x: number; y: number }): void } | null }).ball;
        b?.setLinearVelocity({ x: 0, y: 3 });
      }
      return sim.result!;
    })();
    expect(r.reason).toBe('timeout');
    expect(sim.events.some((e) => e.t === 'timeWarning' && e.step === 60)).toBe(true);
  });

  it('쓰러지는 표적은 0.2초 유지 후 완료, 성공은 0.5초 유예 뒤 판정', () => {
    const lvl = load('double');
    const sim = new Simulation(lvl, solutionEdit(lvl.solutions[0]!));
    const r = sim.run();
    expect(r.status).toBe('win');
    const downs = sim.events.filter((e) => e.t === 'targetDown');
    expect(downs.map((d) => (d as { id: string }).id).sort()).toEqual(['t1', 't2']);
    const last = Math.max(...downs.map((d) => d.step));
    expect(r.step - last).toBe(30);
  });

  it('통과 링을 지나면 두 번째 별, 물건 수 이하면 세 번째 별', () => {
    const ring = load('ring');
    let withRing = 0;
    let without = 0;
    for (let a = 10; a <= 80; a++) {
      const r = runEdit(ring, { cannonAngle: a, placements: [] });
      if (r.status !== 'win') continue;
      if (r.ringPassed) {
        expect(r.stars).toBe(3);
        withRing++;
      } else {
        expect(r.stars).toBe(2);
        without++;
      }
    }
    expect(withRing + without).toBeGreaterThan(0);
  });

  it('쿠션은 정해진 방향·속도를 준다', () => {
    const lvl = load('bumper');
    const sim = new Simulation(lvl, solutionEdit(lvl.solutions[0]!));
    sim.run();
    const ev = sim.events.find((e) => e.t === 'bumper') as { vx: number; vy: number } | undefined;
    expect(ev).toBeDefined();
    expect(Math.hypot(ev!.vx, ev!.vy)).toBeCloseTo(BUMPER_SPEED, 5);
  });

  it('리플레이는 매 단계 위치·각도와 이벤트를 기록한다', () => {
    const lvl = load('double');
    const sim = new Simulation(lvl, solutionEdit(lvl.solutions[0]!), { record: true });
    sim.run();
    expect(sim.replay!.frames.length).toBe(sim.step + 1);
    expect(sim.replay!.bodies.map((b) => b.kind)).toEqual(['ball', 'target', 'target']);
    expect(sim.replay!.events.at(-1)!.t).toBe('win');
  });
});

describe('편집 규칙(3장, 4.1)', () => {
  const lvl = load('double');
  it('겹친 배치는 발사를 막고 문제 위치를 알려준다', () => {
    const s = new Session(lvl);
    s.add('ramp', [2.9, 0.6], 0); // 표적과 겹침
    const r = s.fire();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]!.kind).toBe('overlap');
    expect(s.phase).toBe('edit');
  });
  it('설치 불가 위치에 놓으면 마지막 유효 위치로 돌아간다', () => {
    const s = new Session(lvl);
    const p = s.add('ramp', [2.0, 1.5], 0)!;
    s.moveRaw(p.uid, [2.9, 0.6]);
    const d = s.drop(p.uid, [2.0, 1.5]);
    expect(d.ok).toBe(false);
    expect(s.find(p.uid)!.pos).toEqual([2.0, 1.5]);
  });
  it('회전은 15도 스냅, 대포 각도는 범위 제한', () => {
    expect(snapRot(22)).toBe(15);
    expect(snapRot(-7)).toBe(0);
    expect(snapRot(-8)).toBe(-15);
    expect(snapRot(190)).toBe(-165);
    const s = new Session(lvl);
    s.setCannonAngle(120);
    expect(s.edit.cannonAngle).toBe(80);
    const p = s.add('ramp', [2.0, 1.5], 0)!;
    s.rotate(p.uid, 15);
    s.rotate(p.uid, 15);
    expect(s.find(p.uid)!.rot).toBe(30);
  });
  it('되돌리기와 초기 배치 복원', () => {
    const s = new Session(lvl);
    s.setCannonAngle(30);
    const p = s.add('ramp', [2.0, 1.5], 0)!;
    s.rotate(p.uid, 15);
    expect(s.undo()).toBe(true);
    expect(s.find(p.uid)!.rot).toBe(0);
    expect(s.undo()).toBe(true);
    expect(s.edit.placements.length).toBe(0);
    s.add('ramp', [2.0, 1.5], 0);
    s.resetAll();
    expect(s.edit.placements.length).toBe(0);
    expect(s.edit.cannonAngle).toBe(lvl.cannon.angle);
  });
  it('수량 제한: 남은 수량이 없으면 추가 불가', () => {
    const s = new Session(lvl);
    expect(s.add('ramp', [2.0, 1.5], 0)).not.toBeNull();
    expect(s.add('ramp', [1.5, 2.5], 0)).toBeNull();
    expect(s.add('bumper', [1.5, 2.5], 0)).toBeNull();
  });
  it('발사 중에는 편집 불가, 재배치는 실패로 기록하지 않고 즉시 복귀', () => {
    const s = new Session(lvl, solutionEdit(lvl.solutions[0]!));
    s.fire();
    expect(s.setCannonAngle(20)).toBe(false);
    expect(s.add('ramp', [2, 2], 0)).toBeNull();
    s.frame(0.5);
    s.retry();
    expect(s.phase).toBe('edit');
    expect(s.lastResult).toBeNull();
  });
  it('2배속 설정은 다음 발사에도 유지', () => {
    const s = new Session(lvl);
    s.toggleSpeed();
    s.fire();
    s.retry();
    s.fire();
    expect(s.speed).toBe(2);
    expect(s.frame(1 / 60)).toBe(2);
  });
  it('놓을 수 있는 배치는 문제 없음', () => {
    expect(editProblems(lvl, solutionEdit(lvl.solutions[0]!))).toEqual([]);
  });
});

describe('고정 단계 구동기와 예상 궤적', () => {
  it('2배속은 단계 간격을 키우지 않고 프레임당 단계를 두 배 실행', () => {
    const a = new FixedStepper();
    const b = new FixedStepper();
    let na = 0;
    let nb = 0;
    for (let i = 0; i < 60; i++) {
      na += a.frame(1 / 60, 1);
      nb += b.frame(1 / 60, 2);
    }
    expect(na).toBe(60);
    expect(nb).toBe(120);
    expect(STEP_DT).toBeCloseTo(1 / 60);
  });
  it('예상 궤적은 첫 충돌 전에 멈춘다', () => {
    const lvl = load('ring');
    const path = previewPath(lvl, { cannonAngle: 45, placements: [] }, 5);
    const last = path.at(-1)!;
    expect(last[1]).toBeGreaterThan(-0.2);
    expect(path.length).toBeGreaterThan(5);
  });
});

describe('src/core 규칙', () => {
  it('Math.random과 브라우저 API를 쓰지 않는다', () => {
    const dir = join(__dirname, '..', 'src', 'core');
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/Math\.random|window\.|document\.|requestAnimationFrame|performance\.now/);
    }
  });
});
