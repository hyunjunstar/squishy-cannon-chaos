// 이미지 애셋 로딩(10.6). 투명 영역을 잘라 충돌 모양에 맞춰 배치할 수 있게 한다.
// 애셋이 없거나 실패하면 절차적 그림으로 대체한다.
import { Graphics, Rectangle, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';

export const ART_FILES = {
  barrel: 'device_cannon_barrel_default',
  base: 'device_cannon_base_default',
  ball: 'prop_ball_default',
  ramp: 'device_ramp_default',
  bumper: 'device_bumper_default',
  target: 'target_knockdown_default',
  targetDown: 'target_knockdown_down',
  ring: 'prop_ring_gold',
  bg: 'bg_toyroom_default',
} as const;
export type ArtKey = keyof typeof ART_FILES;

export type Art = Partial<Record<ArtKey, Texture>>;

export interface FxTextures {
  dot: Texture;
  soft: Texture;
  star: Texture;
  ring: Texture;
  confetti: Texture;
  streak: Texture;
  puff: Texture;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

/** 알파 바운딩 박스로 자른 텍스처. alphaCut 미만 알파는 지운다(배경 제거 잔여 후광 정리) */
async function loadTrimmed(name: string, alphaCut: number, maxSide: number): Promise<Texture> {
  const img = await loadImage(`img/${name}.png`);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  if (alphaCut <= 0) return Texture.from(cv);
  const data = g.getImageData(0, 0, w, h);
  const d = data.data;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      const a = d[i]!;
      if (a < alphaCut) {
        d[i] = 0;
        continue;
      }
      if (a < alphaCut + 40) d[i] = Math.round(((a - alphaCut) / 40) * 255); // 가장자리 부드럽게
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  g.putImageData(data, 0, 0);
  const base = Texture.from(cv);
  if (x1 <= x0 || y1 <= y0) return base;
  return new Texture({ source: base.source, frame: new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1) });
}

export async function loadArt(): Promise<Art> {
  const art: Art = {};
  const cut: Partial<Record<ArtKey, number>> = { target: 150, targetDown: 150, bg: 0 };
  await Promise.all(
    (Object.keys(ART_FILES) as ArtKey[]).map(async (k) => {
      try {
        art[k] = await loadTrimmed(ART_FILES[k], cut[k] ?? 24, k === 'bg' ? 1200 : 256);
      } catch {
        /* 절차적 그림으로 대체 */
      }
    }),
  );
  return art;
}

export function makeFxTextures(renderer: Renderer): FxTextures {
  const gen = (draw: (g: Graphics) => void) => {
    const g = new Graphics();
    draw(g);
    const t = renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return t;
  };
  const soft = gen((g) => {
    for (let i = 10; i >= 1; i--) g.circle(0, 0, i * 3).fill({ color: 0xffffff, alpha: 0.1 });
  });
  const star = gen((g) => {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 5 : 12;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.poly(pts).fill(0xffffff);
  });
  return {
    dot: gen((g) => g.circle(0, 0, 8).fill(0xffffff)),
    soft,
    star,
    ring: gen((g) => g.circle(0, 0, 24).stroke({ width: 5, color: 0xffffff })),
    confetti: gen((g) => g.roundRect(0, 0, 10, 6, 2).fill(0xffffff)),
    streak: gen((g) => g.roundRect(0, 0, 28, 4, 2).fill(0xffffff)),
    puff: gen((g) => {
      g.circle(0, 0, 14).fill({ color: 0xffffff, alpha: 0.9 });
      g.circle(10, -4, 10).fill({ color: 0xffffff, alpha: 0.9 });
      g.circle(-9, -3, 9).fill({ color: 0xffffff, alpha: 0.9 });
    }),
  };
}
