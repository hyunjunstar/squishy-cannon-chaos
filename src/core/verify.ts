// 레벨 검증 공용 함수: 정답 재현, 허용 범위 흔들기(8.4), 재배치·2배속 동일성(6.4). Node·브라우저 공용.
import { GRID, ROT_SNAP_DEG } from './constants';
import { editProblems, solutionEdit } from './level';
import { Session } from './session';
import { Simulation } from './sim';
import type { EditState, LevelData, SimResult, SolutionDef } from './types';

export function runEdit(level: LevelData, edit: EditState): SimResult {
  return new Simulation(level, edit).run();
}

export interface ToleranceReport {
  total: number;
  wins: number;
  rate: number;
}

/** 정답 주변 위치 ±1칸, 각도 ±15도, 대포 ±2도를 하나씩 흔든다 */
export function tolerance(level: LevelData, sol: SolutionDef): ToleranceReport {
  const base = solutionEdit(sol);
  const variants: EditState[] = [];
  for (const d of [-2, -1, 1, 2]) variants.push({ ...base, cannonAngle: base.cannonAngle + d });
  base.placements.forEach((_, i) => {
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1])
        for (const dr of [-ROT_SNAP_DEG, 0, ROT_SNAP_DEG]) {
          if (dx === 0 && dy === 0 && dr === 0) continue;
          const e = solutionEdit(sol);
          const p = e.placements[i]!;
          p.pos = [Math.round((p.pos[0] + dx * GRID) * 1e4) / 1e4, Math.round((p.pos[1] + dy * GRID) * 1e4) / 1e4];
          p.rot += dr;
          variants.push(e);
        }
  });
  let total = 0;
  let wins = 0;
  const [lo, hi] = level.cannon.angleRange;
  for (const v of variants) {
    if (v.cannonAngle < lo || v.cannonAngle > hi) continue;
    if (editProblems(level, v).length) continue; // 놓을 수 없는 변형은 제외
    total++;
    if (runEdit(level, v).status === 'win') wins++;
  }
  return { total, wins, rate: total ? wins / total : 1 };
}

/** 프레임 구동으로 끝까지 실행(화면 프레임 간격이 흔들려도 결과 동일해야 함) */
export function runViaFrames(level: LevelData, edit: EditState, speed: 1 | 2, frameDts: number[]): { result: SimResult; hash: string } {
  const s = new Session(level, edit);
  if (speed === 2) s.toggleSpeed();
  const fired = s.fire(false);
  if (!fired.ok) throw new Error('fire blocked');
  let i = 0;
  while (s.phase === 'running') s.frame(frameDts[i++ % frameDts.length]!);
  return { result: s.lastResult!, hash: s.sim!.stateHash() };
}

/** 발사 → 중간에 재배치 → 상태가 발사 직전과 같은지 */
export function retryRestores(level: LevelData, edit: EditState, abortAfterFrames = 40): boolean {
  const s = new Session(level, edit);
  const before = JSON.stringify(s.edit);
  const startHash = new Simulation(level, s.edit).stateHash();
  s.fire(false);
  for (let i = 0; i < abortAfterFrames && s.phase === 'running'; i++) s.frame(1 / 60);
  s.retry();
  if (s.phase !== 'edit' || JSON.stringify(s.edit) !== before) return false;
  // 재발사 직후 월드 상태도 처음 발사와 같아야 한다(표적·장치 전부 복원)
  s.fire(false);
  return s.sim!.stateHash() === startHash;
}
