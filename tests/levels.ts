// npm run test:levels — 모든 레벨: 정답 100회 재현, 재배치 후 상태 동일, 2배속 결과 동일, 허용 범위 흔들기(8.4).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { solutionEdit, validateLevel, editProblems } from '../src/core/level';
import { Simulation } from '../src/core/sim';
import { retryRestores, runViaFrames, tolerance } from '../src/core/verify';
import type { LevelData } from '../src/core/types';

const dir = join(import.meta.dirname, '..', 'levels');
const files = readdirSync(dir).filter((f) => /^level\d+\.json$/.test(f)).sort();
const levels = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as LevelData);

const rows: string[][] = [];
let allOk = true;
const t0 = Date.now();
for (const [i, level] of levels.entries()) {
  const errs = validateLevel(level);
  const sol = level.solutions[0];
  let repro = 0;
  let sameHash = true;
  let retry = false;
  let speed = false;
  let tol = '-';
  let placeable = false;
  if (sol && !errs.length) {
    const edit = solutionEdit(sol);
    placeable = editProblems(level, edit).length === 0;
    let hash = '';
    for (let k = 0; k < 100; k++) {
      const sim = new Simulation(level, solutionEdit(sol));
      if (sim.run().status === 'win') repro++;
      const h = sim.stateHash();
      if (k === 0) hash = h;
      else if (h !== hash) sameHash = false;
    }
    retry = retryRestores(level, edit, 45);
    const a = runViaFrames(level, edit, 1, [1 / 60]);
    const b = runViaFrames(level, edit, 2, [1 / 60]);
    const c = runViaFrames(level, edit, 2, [1 / 30, 1 / 144, 0.021]);
    speed = a.hash === b.hash && a.hash === c.hash && a.result.status === b.result.status;
    const t = tolerance(level, sol);
    tol = `${Math.round(t.rate * 100)}% (${t.wins}/${t.total})`;
  }
  const ok = !errs.length && !!sol && placeable && repro === 100 && sameHash && retry && speed;
  if (!ok) allOk = false;
  rows.push([
    String(i + 1).padStart(2),
    level.levelId,
    (level.name ?? '').padEnd(10),
    `${repro}/100${sameHash ? '' : ' (해시 다름)'}`,
    retry ? '동일' : '다름',
    speed ? '동일' : '다름',
    tol,
    ok ? 'PASS' : `FAIL${errs.length ? ' ' + errs.join(';') : ''}`,
  ]);
}
const head = ['#', 'levelId', '이름', '정답 100회 재현', '재배치 후 상태', '2배속 결과', '허용 범위 성공률', '판정'];
console.log(head.join(' | '));
for (const r of rows) console.log(r.join(' | '));
const passed = rows.filter((r) => r[7] === 'PASS').length;
console.log(`\n${passed}/${levels.length} 레벨 통과 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(allOk && levels.length >= 15 ? 'TEST:LEVELS PASS' : 'TEST:LEVELS FAIL');
process.exit(allOk && levels.length >= 15 ? 0 : 1);
