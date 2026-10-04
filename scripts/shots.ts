// npm run shots: 주요 화면 스크린샷(.shots/) + 이펙트 켠 상태 프레임 시간 측정 + 이펙트 켠 상태 결과 동일성.
import { mkdirSync } from 'node:fs';
import { client, openHarness } from './harness';
import type { Page } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
import { solutionEdit } from '../src/core/level';
import { Simulation } from '../src/core/sim';
import type { LevelData } from '../src/core/types';

const nodeLevels = readdirSync('levels').filter((f) => /^level\d+\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync('levels/' + f, 'utf8')) as LevelData);
const nodeOutcome = (n: number) => {
  const l = nodeLevels[n - 1]!;
  const r = new Simulation(l, solutionEdit(l.solutions[0]!)).run();
  return `${r.status}/${r.stars}/${r.goalsDone.join(',')}`;
};

mkdirSync('.shots', { recursive: true });
const g = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as any).__game[f as string](...(a as unknown[])), [fn, args] as const);
const st = (page: Page) => page.evaluate(() => (window as any).__game.state());
const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: `.shots/${name}.png` });
  console.log(`  saved .shots/${name}.png`);
};

const h = await openHarness('');
const { page } = h;
const levels: number = await page.evaluate(() => (window as any).__game.levels);
const pickLevel = async (pred: (l: any) => boolean, fallback: number) => {
  const all = await page.evaluate(() => (window as any).__game.game.levels);
  const i = all.findIndex(pred);
  return i >= 0 ? i + 1 : fallback;
};

console.log('[1] 화면 스크린샷');
await g(page, 'resetSave');
await page.reload();
await page.waitForFunction(() => document.body.dataset.ready === '1');
await page.waitForTimeout(500);
await shot(page, '01_home');

// 편집 화면: 물건 2개 이상인 레벨에 정답 적용 후 하나 선택
const editLv = await pickLevel((l) => l.solutions[0]?.objects.length >= 2 && l.placeable.some((d: any) => d.type === 'bumper'), 1);
await g(page, 'start', editLv);
await page.waitForTimeout(300);
await g(page, 'applySolution');
await page.waitForTimeout(100);
const edit = (await st(page)).edit;
if (edit.placements.length) {
  const p = edit.placements[0];
  const [cx, cy] = await client(page, p.pos[0] * 80 + 3, (8 - p.pos[1]) * 80 + 66);
  await page.mouse.click(cx, cy);
}
await page.waitForTimeout(350);
await shot(page, '02_edit');

// 발사 순간
const [ex, ey] = await client(page, 195, 150);
await page.mouse.click(ex, ey);
await page.click('[data-id="fire"]');
await page.waitForTimeout(70);
await shot(page, '03_fire');

// 연쇄: 표적이 쓰러지는 순간
await page.waitForFunction(() => (window as any).__game.state().downs > 0, null, { timeout: 30000 });
await page.waitForTimeout(90);
await shot(page, '04_chain');

// 성공 리플레이
await page.waitForSelector('[data-id="result"]', { timeout: 30000 });
await page.waitForFunction(() => (window as any).__game.state().replayProgress > 0.55, null, { timeout: 30000 });
await shot(page, '05_replay');

// 실패 피드백
await g(page, 'start', 1);
await page.waitForTimeout(200);
await page.click('[data-id="fire"]');
await page.waitForFunction(() => (window as any).__game.state().phase === 'done', null, { timeout: 30000 });
await page.waitForTimeout(500);
await shot(page, '06_fail');

console.log('[2] 이펙트 켠 상태 프레임 시간 측정');
const chainLv = await pickLevel((l) => l.goals.length >= 3, editLv);
await g(page, 'start', chainLv);
await page.waitForTimeout(300);
await g(page, 'applySolution');
await g(page, 'setSpeed', 1);
await g(page, 'perfStart');
await page.click('[data-id="fire"]');
await page.waitForFunction(() => (window as any).__game.state().phase === 'done', null, { timeout: 40000 });
await page.waitForTimeout(2500); // 승리 연출 + 리플레이 일부 포함
const perf = await g(page, 'perfStop');
const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const avg = a.reduce((x, y) => x + y, 0) / a.length;
  return { avg: avg.toFixed(2), p95: s[Math.floor(s.length * 0.95)]!.toFixed(2), max: s[s.length - 1]!.toFixed(2) };
};
const fr = stats(perf.frames);
const wk = stats(perf.work);
const spawned = (await st(page)).fxSpawned;
console.log(`  레벨 ${chainLv}, 프레임 ${perf.frames.length}개, 파티클 ${spawned}개 생성`);
console.log(`  프레임 간격(ms): 평균 ${fr.avg} / p95 ${fr.p95} / 최대 ${fr.max}`);
console.log(`  프레임 작업 시간(업데이트+렌더, ms): 평균 ${wk.avg} / p95 ${wk.p95} / 최대 ${wk.max}  (목표 16.7ms 이하: ${Number(wk.p95) <= 16.7 ? '충족' : '미달'})`);

console.log('[3] 이펙트 켠 상태 결과 동일성: 같은 엔진 순수 시뮬레이션(비트 단위) + Node(승패·별·표적)');
let same = 0;
let sameNode = 0;
for (let n = 1; n <= levels; n++) {
  await g(page, 'start', n);
  await page.waitForTimeout(50);
  await g(page, 'applySolution');
  await g(page, 'setSpeed', n % 2 ? 2 : 1);
  await page.click('[data-id="fire"]');
  await page.waitForFunction(() => (window as any).__game.state().phase === 'done', null, { timeout: 60000 });
  const s = await st(page);
  const plainHash = await g(page, 'plainHash', n); // 같은 브라우저, 이펙트·화면 없이 순수 시뮬레이션
  const browserOutcome = `${s.result.status}/${s.result.stars}/${s.result.goalsDone.join(',')}`;
  const eq = s.hash === plainHash && s.result.status === 'win';
  const nodeEq = browserOutcome === nodeOutcome(n);
  if (eq) same++;
  if (nodeEq) sameNode++;
  console.log(`  레벨 ${String(n).padStart(2)}: ${s.result.status} ${n % 2 ? '2배속' : '1배속'} | 이펙트 켬 vs 순수 시뮬 해시 ${eq ? '동일' : '다름'} | Node 결과(${nodeOutcome(n)}) ${nodeEq ? '동일' : '다름'}`);
}
console.log(`  이펙트 켠 상태 결과 동일(같은 엔진 비트 단위): ${same}/${levels}, Node와 결과(승패·별·표적) 동일: ${sameNode}/${levels}`);
const errs = h.errors.filter((e) => !e.includes('404'));
if (errs.length) console.log('페이지 오류:', errs);
await h.close();
process.exit(same === levels && sameNode === levels && !errs.length ? 0 : 1);
