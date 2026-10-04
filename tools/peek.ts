// 임시 화면 확인: tsx tools/peek.ts "?level=1" out.png
import { mkdirSync } from 'node:fs';
import { openHarness } from '../scripts/harness';
const h = await openHarness(process.argv[2] ?? '');
await h.page.waitForTimeout(Number(process.argv[4] ?? 600));
mkdirSync('.shots', { recursive: true });
await h.page.screenshot({ path: `.shots/${process.argv[3] ?? 'peek.png'}` });
console.log('errors:', h.errors);
await h.close();
