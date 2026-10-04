// 레벨 데이터 스키마(기획서 5.4)와 시뮬레이션 공용 타입. 화면·브라우저 API 의존 없음.

export type Vec = [number, number];

export type PlaceableType = 'ramp' | 'bumper';
export type FixedType = 'wall' | 'ramp' | 'bumper' | 'bell';

export interface CannonDef {
  pos: Vec;
  angleRange: [number, number];
  angle: number;
  speed: number;
}

export interface FixedDef {
  id: string;
  type: FixedType;
  pos: Vec;
  size?: Vec; // wall 전용
  rot: number;
}

export interface PlaceableDef {
  type: PlaceableType;
  count: number;
  area: 'free' | 'sockets';
  bounds?: [Vec, Vec];
  sockets?: Vec[];
}

export type TargetDir = 'left' | 'right' | 'any';

export interface GoalDef {
  id: string;
  type: 'knockdown';
  pos: Vec; // 표적 중심
  dir: TargetDir;
  size?: Vec;
}

export interface RingDef {
  type: 'ring';
  id: string;
  pos: Vec;
  /** 통과 방향(도). 생략 시 어느 방향이든 인정 */
  dir?: number;
}

export interface ForbiddenDef {
  type: 'touch';
  target: string;
}

export interface PlacementData {
  type: PlaceableType;
  pos: Vec;
  rot: number;
}

export interface SolutionDef {
  cannonAngle: number;
  objects: PlacementData[];
}

export interface LevelData {
  levelId: string;
  version: number;
  theme: string;
  name?: string;
  /** 1레벨 손가락 안내 등 연출용 짧은 힌트 */
  tutorial?: 'drag-cannon' | 'drag-object' | 'rotate-object' | 'bumper' | 'ring';
  cannon: CannonDef;
  fixed: FixedDef[];
  placeable: PlaceableDef[];
  goals: GoalDef[];
  forbidden?: ForbiddenDef[];
  bonusGoal?: RingDef;
  starMaxObjects: number;
  timeLimit?: number;
  solutions: SolutionDef[];
}

/** 편집 중인 배치 상태. 발사 시점 스냅샷의 단위 */
export interface Placement extends PlacementData {
  uid: number;
}

export interface EditState {
  cannonAngle: number;
  placements: Placement[];
}

export type FailReason = 'stalled' | 'forbidden' | 'timeout';

export type SimEvent =
  | { t: 'fire'; step: number; x: number; y: number; vx: number; vy: number }
  | { t: 'hit'; step: number; x: number; y: number; impulse: number; a: string; b: string }
  | { t: 'bumper'; step: number; x: number; y: number; id: string; vx: number; vy: number }
  | { t: 'targetHit'; step: number; id: string; x: number; y: number }
  | { t: 'targetDown'; step: number; id: string; x: number; y: number }
  | { t: 'ring'; step: number; id: string; x: number; y: number }
  | { t: 'ballLost'; step: number; x: number; y: number }
  | { t: 'timeWarning'; step: number }
  | { t: 'forbidden'; step: number; id: string; x: number; y: number }
  | { t: 'win'; step: number }
  | { t: 'fail'; step: number; reason: FailReason };

export interface FocusPoint {
  x: number;
  y: number;
  kind: 'device' | 'trajectory' | 'forbidden' | 'target';
  label: string;
}

export interface SimResult {
  status: 'win' | 'fail';
  reason?: FailReason;
  step: number;
  goalsDone: string[];
  ringPassed: boolean;
  stars: number;
  focus?: FocusPoint;
}

/** 리플레이: 물리를 다시 돌리지 않고 기록된 위치·각도·이벤트를 재생(6.5) */
export interface ReplayBodyMeta {
  id: string;
  kind: 'ball' | 'target';
}
export interface Replay {
  levelId: string;
  bodies: ReplayBodyMeta[];
  /** frames[step] = [x0,y0,a0, x1,y1,a1, ...] (없는 물체는 NaN) */
  frames: Float32Array[];
  events: SimEvent[];
  edit: EditState;
}
