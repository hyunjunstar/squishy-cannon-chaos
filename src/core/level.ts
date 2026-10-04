import { circlePolyOverlap, polysOverlap, rectCorners, round4, snap } from './geometry';
import { BALL_RADIUS, CANNON_BARREL, GRID, ROT_SNAP_DEG, SIZE, WORLD_H, WORLD_W } from './constants';
import type { EditState, FixedDef, LevelData, Placement, PlaceableType, Vec } from './types';

/** 방 테두리(바닥·좌우 벽). 모든 레벨 공통 */
export const ROOM_WALLS: FixedDef[] = [
  { id: 'room_floor', type: 'wall', pos: [WORLD_W / 2, -0.2], size: [WORLD_W + 0.8, 0.4], rot: 0 },
  { id: 'room_left', type: 'wall', pos: [-0.2, WORLD_H / 2], size: [0.4, WORLD_H + 0.4], rot: 0 },
  { id: 'room_right', type: 'wall', pos: [WORLD_W + 0.2, WORLD_H / 2], size: [0.4, WORLD_H + 0.4], rot: 0 },
];

export function fixedSize(f: FixedDef): Vec {
  if (f.type === 'wall') return f.size ?? [0.2, 1];
  return SIZE[f.type];
}

export function placeableSize(type: PlaceableType): Vec {
  return SIZE[type];
}

export function fixedPoly(f: FixedDef): Vec[] {
  return rectCorners(f.pos, fixedSize(f), f.rot);
}

export function placementPoly(p: { type: PlaceableType; pos: Vec; rot: number }): Vec[] {
  return rectCorners(p.pos, placeableSize(p.type), p.rot);
}

export function goalSize(g: { size?: Vec }): Vec {
  return g.size ?? SIZE.target;
}

export function newEditState(level: LevelData): EditState {
  return { cannonAngle: level.cannon.angle, placements: [] };
}

export function cloneEdit(e: EditState): EditState {
  return {
    cannonAngle: e.cannonAngle,
    placements: e.placements.map((p) => ({ uid: p.uid, type: p.type, pos: [p.pos[0], p.pos[1]], rot: p.rot })),
  };
}

export function editEquals(a: EditState, b: EditState): boolean {
  return JSON.stringify(cloneEdit(a)) === JSON.stringify(cloneEdit(b));
}

export function clampCannon(level: LevelData, deg: number): number {
  const [lo, hi] = level.cannon.angleRange;
  return Math.max(lo, Math.min(hi, Math.round(deg)));
}

export function snapPos(p: Vec): Vec {
  return [round4(snap(p[0], GRID)), round4(snap(p[1], GRID))];
}

export function snapRot(r: number): number {
  let d = snap(r, ROT_SNAP_DEG) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d === 0 ? 0 : d; // -0 제거
}

export function countByType(edit: EditState, type: PlaceableType): number {
  return edit.placements.filter((p) => p.type === type).length;
}

export function remaining(level: LevelData, edit: EditState, type: PlaceableType): number {
  const def = level.placeable.find((d) => d.type === type);
  return (def?.count ?? 0) - countByType(edit, type);
}

export type ProblemKind = 'area' | 'overlap' | 'outside' | 'count';
export interface PlacementProblem {
  uid: number;
  kind: ProblemKind;
  at: Vec;
}

/** 소켓형이면 가장 가까운 소켓, 자유형이면 격자 스냅 */
export function snapToArea(level: LevelData, type: PlaceableType, p: Vec): Vec {
  const def = level.placeable.find((d) => d.type === type);
  if (def?.area === 'sockets' && def.sockets?.length) {
    let best = def.sockets[0]!;
    let bd = Infinity;
    for (const s of def.sockets) {
      const d = Math.hypot(s[0] - p[0], s[1] - p[1]);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return [best[0], best[1]];
  }
  return snapPos(p);
}

/** 한 배치가 놓일 수 있는지 검사(기획서 3장 배치 규칙, 4.1 겹침 발사 차단) */
export function placementProblem(level: LevelData, edit: EditState, pl: Placement): PlacementProblem | null {
  const def = level.placeable.find((d) => d.type === pl.type);
  if (!def) return { uid: pl.uid, kind: 'count', at: pl.pos };
  if (def.area === 'sockets') {
    const ok = (def.sockets ?? []).some((s) => Math.abs(s[0] - pl.pos[0]) < 0.01 && Math.abs(s[1] - pl.pos[1]) < 0.01);
    if (!ok) return { uid: pl.uid, kind: 'area', at: pl.pos };
  } else if (def.bounds) {
    const [[x0, y0], [x1, y1]] = def.bounds;
    if (pl.pos[0] < x0 - 1e-6 || pl.pos[0] > x1 + 1e-6 || pl.pos[1] < y0 - 1e-6 || pl.pos[1] > y1 + 1e-6) {
      return { uid: pl.uid, kind: 'area', at: pl.pos };
    }
  }
  const poly = placementPoly(pl);
  for (const [x, y] of poly) {
    if (x < 0 || x > WORLD_W || y < 0 || y > WORLD_H) return { uid: pl.uid, kind: 'outside', at: pl.pos };
  }
  for (const f of level.fixed) {
    if (polysOverlap(poly, fixedPoly(f), 0.02)) return { uid: pl.uid, kind: 'overlap', at: pl.pos };
  }
  for (const g of level.goals) {
    if (polysOverlap(poly, rectCorners(g.pos, goalSize(g), 0), 0.04)) return { uid: pl.uid, kind: 'overlap', at: pl.pos };
  }
  if (circlePolyOverlap(level.cannon.pos, 0.42, poly)) return { uid: pl.uid, kind: 'overlap', at: pl.pos };
  // 포구에서 생성되는 공 자리
  const m = muzzle(level, edit.cannonAngle);
  if (circlePolyOverlap(m, BALL_RADIUS + 0.05, poly)) return { uid: pl.uid, kind: 'overlap', at: pl.pos };
  for (const o of edit.placements) {
    if (o.uid === pl.uid) continue;
    if (polysOverlap(poly, placementPoly(o), 0.02)) return { uid: pl.uid, kind: 'overlap', at: pl.pos };
  }
  return null;
}

export function editProblems(level: LevelData, edit: EditState): PlacementProblem[] {
  const out: PlacementProblem[] = [];
  for (const def of level.placeable) {
    if (countByType(edit, def.type) > def.count) {
      const last = edit.placements.filter((p) => p.type === def.type).at(-1)!;
      out.push({ uid: last.uid, kind: 'count', at: last.pos });
    }
  }
  for (const p of edit.placements) {
    const pr = placementProblem(level, edit, p);
    if (pr) out.push(pr);
  }
  return out;
}

export function muzzle(level: LevelData, angleDeg: number): Vec {
  const a = (angleDeg * Math.PI) / 180;
  return [level.cannon.pos[0] + Math.cos(a) * CANNON_BARREL, level.cannon.pos[1] + Math.sin(a) * CANNON_BARREL];
}

/** 레벨 구조 검사: id 중복, 범위, 신호 순환 등 */
export function validateLevel(level: LevelData): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const all = [...level.fixed.map((f) => f.id), ...level.goals.map((g) => g.id)];
  if (level.bonusGoal) all.push(level.bonusGoal.id);
  for (const id of all) {
    if (ids.has(id)) errs.push(`duplicate id ${id}`);
    ids.add(id);
  }
  const inWorld = (p: Vec) => p[0] >= 0 && p[0] <= WORLD_W && p[1] >= 0 && p[1] <= WORLD_H;
  if (!inWorld(level.cannon.pos)) errs.push('cannon outside world');
  for (const g of level.goals) if (!inWorld(g.pos)) errs.push(`goal ${g.id} outside world`);
  if (level.goals.length === 0) errs.push('no goals');
  const [lo, hi] = level.cannon.angleRange;
  if (!(lo <= level.cannon.angle && level.cannon.angle <= hi)) errs.push('cannon angle outside range');
  for (const f of level.forbidden ?? []) {
    if (!level.fixed.some((x) => x.id === f.target)) errs.push(`forbidden target ${f.target} missing`);
  }
  for (const s of level.solutions) {
    for (const o of s.objects) if (!level.placeable.some((d) => d.type === o.type)) errs.push(`solution uses ${o.type}`);
  }
  return errs;
}

/** 정답 배치를 EditState로 변환 */
export function solutionEdit(sol: { cannonAngle: number; objects: { type: PlaceableType; pos: Vec; rot: number }[] }): EditState {
  return {
    cannonAngle: sol.cannonAngle,
    placements: sol.objects.map((o, i) => ({ uid: i + 1, type: o.type, pos: [o.pos[0], o.pos[1]], rot: o.rot })),
  };
}
