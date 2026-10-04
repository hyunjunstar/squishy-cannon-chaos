// 예상 궤적: 첫 충돌 전까지 짧게(3장 "예측"). 물리 엔진 없이 포물선 표본으로 계산.
import { BALL_RADIUS, CANNON_BARREL, GRAVITY, WORLD_H, WORLD_W } from './constants';
import { circlePolyOverlap } from './geometry';
import { ROOM_WALLS, fixedPoly, goalSize, placementPoly } from './level';
import { rectCorners } from './geometry';
import type { EditState, LevelData, Vec } from './types';

export function previewPath(level: LevelData, edit: EditState, maxTime = 0.55, dt = 1 / 60): Vec[] {
  const a = (edit.cannonAngle * Math.PI) / 180;
  const { pos, speed } = level.cannon;
  let x = pos[0] + Math.cos(a) * CANNON_BARREL;
  let y = pos[1] + Math.sin(a) * CANNON_BARREL;
  let vx = Math.cos(a) * speed;
  let vy = Math.sin(a) * speed;
  const polys = [
    ...[...ROOM_WALLS, ...level.fixed].map(fixedPoly),
    ...level.goals.map((g) => rectCorners(g.pos, goalSize(g), 0)),
    ...edit.placements.map(placementPoly),
  ];
  const out: Vec[] = [[x, y]];
  for (let t = 0; t < maxTime; t += dt) {
    vy -= GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    out.push([x, y]);
    if (x < 0 || x > WORLD_W || y < 0 || y > WORLD_H) break;
    if (polys.some((p) => circlePolyOverlap([x, y], BALL_RADIUS, p))) break;
  }
  return out;
}
