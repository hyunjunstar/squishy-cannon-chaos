// 레벨 정답 탐색(8.5 자동 검증). 시드 고정 난수로 배치 후보를 뽑아 시뮬레이션한다.
// 사용: tsx tools/solve.ts levels/level02.json [samples] [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { GRID } from '../src/core/constants';
import { editProblems, snapRot } from '../src/core/level';
import { runEdit, tolerance } from '../src/core/verify';
import type { EditState, LevelData, PlacementData, SolutionDef } from '../src/core/types';

const file = process.argv[2]!;
const samples = Number(process.argv[3] ?? 3000);
const write = process.argv.includes('--write');
const level = JSON.parse(readFileSync(file, 'utf8')) as LevelData;

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;

const [lo, hi] = level.cannon.angleRange;
const zero: number[] = [];
for (let a = lo; a <= hi; a++) if (runEdit(level, { cannonAngle: a, placements: [] }).status === 'win') zero.push(a);
console.log(`${level.levelId}: 0-object wins at [${zero.join(',')}]`);

const found: { sol: SolutionDef; n: number; step?: number }[] = [];
const types = level.placeable.flatMap((d) => Array.from({ length: d.count }, () => d));
if (types.length) {
  for (let i = 0; i < samples; i++) {
    const k = 1 + Math.floor(rnd() * types.length);
    const objs: PlacementData[] = [];
    const order = types.map((t) => ({ t, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.t);
    for (const d of order.slice(0, k)) {
      let pos: [number, number];
      if (d.area === 'sockets') pos = [...pick(d.sockets!)] as [number, number];
      else {
        const [[x0, y0], [x1, y1]] = d.bounds!;
        pos = [Math.round((x0 + rnd() * (x1 - x0)) / GRID) * GRID, Math.round((y0 + rnd() * (y1 - y0)) / GRID) * GRID];
        pos = [Math.round(pos[0] * 1e4) / 1e4, Math.round(pos[1] * 1e4) / 1e4];
      }
      objs.push({ type: d.type, pos, rot: snapRot(Math.floor(rnd() * 24) * 15) });
    }
    const edit: EditState = {
      cannonAngle: lo + Math.floor(rnd() * (hi - lo + 1)),
      placements: objs.map((o, j) => ({ ...o, uid: j + 1 })),
    };
    if (editProblems(level, edit).length) continue;
    const res = runEdit(level, edit);
    if (res.status === 'win' && (!level.bonusGoal || res.ringPassed)) found.push({ sol: { cannonAngle: edit.cannonAngle, objects: objs }, n: objs.length, step: res.step });
  }
} 
if (!types.length) for (const a of zero) found.push({ sol: { cannonAngle: a, objects: [] }, n: 0 });
console.log(`found ${found.length} solutions`);
const scored = found.slice(0, 80).map((f) => ({ ...f, tol: tolerance(level, f.sol) }));
// 허용 범위가 넓고, 느린 밀기에 기대지 않는(빨리 끝나는) 정답 우선 — 기기 간 미세 차이에 강하다(6.4)
scored.sort((a, b) => b.tol.rate - (a.step ?? 0) / 4000 - (a.tol.rate - (b.step ?? 0) / 4000) || a.n - b.n);
for (const s of scored.slice(0, 5)) console.log(`  rate ${(s.tol.rate * 100).toFixed(0)}% (${s.tol.wins}/${s.tol.total}) step ${s.step ?? "-"}`, JSON.stringify(s.sol));
if (write && scored.length) {
  level.solutions = scored.slice(0, 2).map((s) => s.sol);
  writeFileSync(file, JSON.stringify(level, null, 2) + '\n');
  console.log('written');
}
