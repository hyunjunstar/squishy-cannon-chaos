import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { solutionEdit } from '../src/core/level';
import { Simulation } from '../src/core/sim';
import { ReplayPlayer } from '../src/render/replay_player';
import type { LevelData } from '../src/core/types';

const level = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'double.json'), 'utf8')) as LevelData;

describe('성공 리플레이(6.5)', () => {
  it('물리 없이 기록된 위치·이벤트를 끝까지 재생하고 다시 처음으로 돌아간다', () => {
    const sim = new Simulation(level, solutionEdit(level.solutions[0]!), { record: true });
    sim.run();
    const rp = new ReplayPlayer(sim.replay!);
    const seen: string[] = [];
    let restarted = false;
    for (let i = 0; i < 60 * 60 && !restarted; i++) {
      const r = rp.update(1 / 60);
      seen.push(...r.events.map((e) => e.t));
      restarted = r.restarted;
    }
    expect(restarted).toBe(true);
    expect(seen).toEqual(sim.events.map((e) => e.t));
    // 마지막 프레임 위치 = 시뮬레이션 마지막 위치
    rp.t = rp.length - 1;
    const last = rp.bodies().find((b) => b.id === 't1')!;
    const real = sim.bodies().find((b) => b.id === 't1')!;
    expect(last.x).toBeCloseTo(real.x, 4);
  });
  it('표적이 쓰러지는 순간 근처는 느리게 재생', () => {
    const sim = new Simulation(level, solutionEdit(level.solutions[0]!), { record: true });
    sim.run();
    const rp = new ReplayPlayer(sim.replay!);
    const down = sim.events.find((e) => e.t === 'targetDown')!;
    rp.t = down.step;
    expect(rp.rate()).toBeLessThan(0.5);
    rp.t = 1;
    expect(rp.rate()).toBe(1);
  });
});
