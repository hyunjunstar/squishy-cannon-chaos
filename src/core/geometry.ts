import type { Vec } from './types';

export const DEG = Math.PI / 180;

/** 중심·크기·각도(도)로 회전된 사각형의 꼭짓점(반시계) */
export function rectCorners(pos: Vec, size: Vec, rotDeg: number): Vec[] {
  const c = Math.cos(rotDeg * DEG);
  const s = Math.sin(rotDeg * DEG);
  const hw = size[0] / 2;
  const hh = size[1] / 2;
  const local: Vec[] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return local.map(([x, y]) => [pos[0] + x * c - y * s, pos[1] + x * s + y * c]);
}

function project(poly: Vec[], ax: Vec): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p[0] * ax[0] + p[1] * ax[1];
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** 볼록 다각형 SAT 겹침 판정. margin>0이면 그만큼 떨어져 있어야 겹치지 않음으로 본다 */
export function polysOverlap(a: Vec[], b: Vec[], margin = 0): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const ax: Vec = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
      const [a0, a1] = project(a, ax);
      const [b0, b1] = project(b, ax);
      if (a1 + margin <= b0 || b1 + margin <= a0) return false;
    }
  }
  return true;
}

export function circlePolyOverlap(c: Vec, r: number, poly: Vec[]): boolean {
  // 원 중심이 다각형 안이거나 변까지 거리 < r
  let inside = true;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cross = (q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0]);
    if (cross < 0) inside = false;
    if (segDist(c, p, q) < r) return true;
  }
  return inside;
}

export function segDist(c: Vec, p: Vec, q: Vec): number {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const l2 = dx * dx + dy * dy || 1;
  let t = ((c[0] - p[0]) * dx + (c[1] - p[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(c[0] - (p[0] + t * dx), c[1] - (p[1] + t * dy));
}

export function snap(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** 부동소수 누적 오차 제거(격자 좌표를 깔끔하게) */
export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function normDeg(d: number): number {
  let r = d % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r;
}
