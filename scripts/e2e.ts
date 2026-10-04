// npm run e2e: 브라우저 자동 플레이. 실제 포인터 입력(대포 손잡이 드래그 → 발사 버튼)으로 1레벨을 클리어한다.
import { readFileSync } from 'node:fs';
import { client, openHarness } from './harness';
import { Simulation } from '../src/core/sim';
import type { LevelData } from '../src/core/types';

const h = await openHarness('?level=1');
const { page } = h;
let ok = false;
try {
  await page.evaluate(() => (window as any).__game.resetSave());
  await page.evaluate(() => (window as any).__game.start(1));
  await page.waitForTimeout(300);
  const sol = await page.evaluate(() => (window as any).__game.solution());
  const [hx, hy] = await page.evaluate(() => (window as any).__game.cannonHandle());
  const [px, py] = await page.evaluate(() => (window as any).__game.cannonPivot());
  // 정답 각도 방향의 점까지 대포 손잡이를 끈다
  const a = (sol.cannonAngle * Math.PI) / 180;
  const tx = px + Math.cos(a) * 90;
  const ty = py - Math.sin(a) * 90;
  const [c0x, c0y] = await client(page, hx, hy);
  const [c1x, c1y] = await client(page, tx, ty);
  await page.mouse.move(c0x, c0y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(c0x + ((c1x - c0x) * i) / 12, c0y + ((c1y - c0y) * i) / 12);
  await page.mouse.up();
  const angle = await page.evaluate(() => (window as any).__game.state().edit.cannonAngle);
  console.log(`대포 드래그: 정답 ${sol.cannonAngle}도 → 현재 ${angle}도`);
  if (angle !== sol.cannonAngle) throw new Error('cannon drag did not reach solution angle');
  await page.click('[data-id="fire"]');
  await page.waitForFunction(() => (window as any).__game.state().phase === 'done', null, { timeout: 30000 });
  const st = await page.evaluate(() => (window as any).__game.state());
  console.log(`결과: ${st.result.status} (별 ${st.result.stars}, ${st.result.step}단계)`);
  const l1 = JSON.parse(readFileSync('levels/level01.json', 'utf8')) as LevelData;
  const ref = new Simulation(l1, { cannonAngle: angle, placements: [] }).run(); // Node 프로세스에서 같은 배치로 계산
  const plain = await page.evaluate(() => (window as any).__game.plainHash(1));
  const sameOutcome = ref.status === st.result.status && ref.stars === st.result.stars;
  console.log(`Node 결과 ${ref.status}/별 ${ref.stars} = 브라우저 결과: ${sameOutcome}`);
  console.log(`브라우저 플레이(이펙트 켬) 해시 = 같은 엔진 순수 시뮬레이션 해시: ${st.hash === plain}`);
  await page.waitForSelector('[data-id="result"]', { timeout: 10000 });
  console.log('결과 화면·리플레이 표시됨');
  ok = st.result.status === 'win' && sameOutcome && st.hash === plain;
  if (h.errors.filter((e) => !e.includes('404')).length) {
    console.log('페이지 오류:', h.errors);
    ok = false;
  }
} catch (e) {
  console.error(e);
} finally {
  await h.close();
}
console.log(ok ? 'E2E PASS: 1레벨 자동 클리어' : 'E2E FAIL');
process.exit(ok ? 0 : 1);
