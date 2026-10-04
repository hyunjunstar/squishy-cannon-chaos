// 기획서 10.1 / 5.2 고정 기준값. 바꿔야 하면 PROGRESS.md "결정 필요"에 적는다.
export const WORLD_W = 4.8;
export const WORLD_H = 8.0;
export const PX_PER_M = 80;
export const STEP_DT = 1 / 60;
export const VELOCITY_ITERS = 8;
export const POSITION_ITERS = 3;
export const GRAVITY = 9.8;
export const ROT_SNAP_DEG = 15;
export const GRID = 0.1; // 배치 격자(미터). 허용 범위 테스트의 "1칸"
export const DEFAULT_TIME_LIMIT = 20;
export const TIME_WARNING_BEFORE = 3;

export const BALL_RADIUS = 0.15;
export const BALL_MASS = 1.0;
export const BALL_MAX_SPEED = 15;
export const SURFACE_FRICTION = 0.3;
export const SURFACE_RESTITUTION = 0.2;
export const CANNON_BARREL = 0.5; // 대포 중심→포구 거리

export const BUMPER_COOLDOWN = 0.1;
export const BUMPER_SPEED = 9; // 쿠션이 주는 고정 속도
export const KNOCKDOWN_ANGLE_DEG = 45;
export const KNOCKDOWN_HOLD = 0.2;
export const WIN_GRACE = 0.5;
export const REST_HOLD = 0.5;
export const REST_LIN = 0.06;
export const REST_ANG = 0.12;

// 크기(미터)
export const SIZE = {
  ramp: [1.2, 0.16] as [number, number],
  bumper: [0.6, 0.26] as [number, number],
  target: [0.3, 0.8] as [number, number],
  bell: [0.4, 0.4] as [number, number],
};
export const RING_HALF = 0.3;
