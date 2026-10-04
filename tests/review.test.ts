// Codex 리뷰 반영 테스트: 보상 계산, 2배속 단계 수, 드래그 중 마지막 유효 위치.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearReward, mergeRecord } from '../src/core/progress';
import { FixedStepper } from '../src/core/runner';
import { Session } from '../src/core/session';
import type { LevelData } from '../src/core/types';

describe('보상(4.8): 첫 클리어 20개, 추가 별 개당 5개, 반복 지급 없음', () => {
  it('첫 클리어', () => {
    expect(clearReward(undefined, 1)).toBe(20);
    expect(clearReward(undefined, 2)).toBe(25);
    expect(clearReward(undefined, 3)).toBe(30);
  });
  it('같은 별로 다시 클리어하면 0, 별을 늘리면 새 별만', () => {
    const r1 = mergeRecord(undefined, 1, 2, 1);
    expect(clearReward(r1, 1)).toBe(0);
    expect(clearReward(r1, 3)).toBe(10);
    const r3 = mergeRecord(r1, 3, 1, 1);
    expect(r3).toEqual({ stars: 3, bestObjects: 1, version: 1 });
    expect(clearReward(r3, 2)).toBe(0);
    expect(mergeRecord(r3, 1, 2, 1).stars).toBe(3);
  });
  it('실패(별 0)는 보상 없음', () => {
    expect(clearReward(undefined, 0)).toBe(0);
  });
});

describe('2배속(6.4): 단계 간격은 그대로, 프레임당 단계 수만 2배', () => {
  it('60fps 프레임 하나: 1배속 1단계, 2배속 2단계', () => {
    expect(new FixedStepper().frame(1 / 60, 1)).toBe(1);
    expect(new FixedStepper().frame(1 / 60, 2)).toBe(2);
  });
  it('프레임이 느려도(30fps) 2배속은 항상 1배속의 정확히 2배 단계', () => {
    for (const dt of [1 / 30, 1 / 45, 1 / 120]) {
      const a = new FixedStepper();
      const b = new FixedStepper();
      let na = 0;
      let nb = 0;
      for (let i = 0; i < 90; i++) {
        na += a.frame(dt, 1);
        nb += b.frame(dt, 2);
      }
      expect(nb).toBe(na * 2);
    }
  });
});

describe('드래그 중 마지막 유효 위치(3장 배치 규칙)', () => {
  const lvl = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'double.json'), 'utf8')) as LevelData;
  it('유효한 중간 지점을 지나 불가능한 곳에 놓으면 중간 지점으로 돌아간다', () => {
    const s = new Session(lvl);
    const p = s.add('ramp', [1.6, 2.5], 0)!;
    let last: [number, number] | null = [1.6, 2.5];
    last = s.dragTo(p.uid, [2.03, 2.02], last); // 유효(스냅 2.0, 2.0)
    expect(last).toEqual([2.0, 2.0]);
    last = s.dragTo(p.uid, [2.9, 0.6], last); // 표적과 겹침 → 유지
    expect(last).toEqual([2.0, 2.0]);
    const d = s.drop(p.uid, last!);
    expect(d.ok).toBe(false);
    expect(s.find(p.uid)!.pos).toEqual([2.0, 2.0]);
  });
});
