// e2e·shots 공용: Vite 개발 서버를 띄우고 Playwright로 브라우저를 연다.
// 브라우저는 설치된 Edge/Chrome 채널을 먼저 쓰고, 없으면 Playwright 기본 Chromium.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

export interface Harness {
  url: string;
  browser: Browser;
  page: Page;
  errors: string[];
  close(): Promise<void>;
}

async function launch(): Promise<Browser> {
  const args = ['--use-angle=default', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true, args });
    } catch {
      /* 다음 후보 */
    }
  }
  return chromium.launch({ headless: true, args });
}

export async function openHarness(query = '', viewport = { width: 390, height: 844 }): Promise<Harness> {
  const server = await createServer({ logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5173;
  const url = `http://127.0.0.1:${port}/`;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: false });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url + query);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
  return {
    url,
    browser,
    page,
    errors,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

export async function client(page: Page, lx: number, ly: number): Promise<[number, number]> {
  return page.evaluate(([x, y]) => (window as any).__game.toClient(x, y), [lx, ly] as const);
}
