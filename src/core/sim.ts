// 고정 단계 물리 시뮬레이션(기획서 4장, 5.2, 6.4). 화면·브라우저 API, Math.random 사용 금지.
import { Box, Circle, Vec2, World } from 'planck';
import type { Body, Contact, ContactImpulse, Fixture } from 'planck';
import {
  BALL_MASS,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BUMPER_COOLDOWN,
  BUMPER_SPEED,
  CANNON_BARREL,
  DEFAULT_TIME_LIMIT,
  GRAVITY,
  KNOCKDOWN_ANGLE_DEG,
  KNOCKDOWN_HOLD,
  POSITION_ITERS,
  REST_ANG,
  REST_HOLD,
  REST_LIN,
  RING_HALF,
  STEP_DT,
  SURFACE_FRICTION,
  SURFACE_RESTITUTION,
  TIME_WARNING_BEFORE,
  VELOCITY_ITERS,
  WIN_GRACE,
  WORLD_W,
} from './constants';
import { DEG } from './geometry';
import { ROOM_WALLS, fixedSize, goalSize, placeableSize } from './level';
import type {
  EditState,
  FailReason,
  FocusPoint,
  GoalDef,
  LevelData,
  Replay,
  ReplayBodyMeta,
  SimEvent,
  SimResult,
  Vec,
} from './types';

type Kind = 'ball' | 'target' | 'wall' | 'ramp' | 'bumper' | 'bell';
interface Tag {
  kind: Kind;
  id: string;
}

interface TargetState {
  def: GoalDef;
  body: Body;
  holdSteps: number;
  done: boolean;
  hit: boolean;
}

interface BumperState {
  id: string;
  body: Body;
  dir: Vec;
  cooldownUntil: number;
}

const stepsOf = (sec: number) => Math.round(sec / STEP_DT);

export interface BodyView {
  id: string;
  kind: 'ball' | 'target';
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  done?: boolean;
}

export class Simulation {
  readonly level: LevelData;
  readonly edit: EditState;
  readonly world: World;
  step = 0;
  finished = false;
  result: SimResult | null = null;
  readonly events: SimEvent[] = [];
  readonly replay: Replay | null;

  private ball: Body | null = null;
  private readonly targets: TargetState[] = [];
  private readonly bumpers = new Map<string, BumperState>();
  private readonly timeLimitSteps: number;
  private restSteps = 0;
  private allDoneAt = -1;
  private forbiddenHit: { id: string; x: number; y: number } | null = null;
  private ringPassed = false;
  private ringPrevSide = 0;
  private closest: { d: number; x: number; y: number; id: string } | null = null;
  private lastDevice: FocusPoint | null = null;
  private pendingHits: { contact: Contact; a: Tag; b: Tag; impulse: number }[] = [];
  private pendingBoost: { id: string } | null = null;
  private readonly replayBodies: Body[] = [];

  constructor(level: LevelData, edit: EditState, opts: { record?: boolean } = {}) {
    this.level = level;
    this.edit = edit;
    this.timeLimitSteps = stepsOf(level.timeLimit ?? DEFAULT_TIME_LIMIT);
    this.world = new World({ gravity: Vec2(0, -GRAVITY), allowSleep: true });
    this.build();
    this.world.on('begin-contact', (c) => this.onBegin(c));
    this.world.on('post-solve', (c, imp) => this.onPostSolve(c, imp));
    this.fire();
    this.replay = opts.record
      ? {
          levelId: level.levelId,
          bodies: this.replayMeta(),
          frames: [],
          events: this.events,
          edit,
        }
      : null;
    this.record();
  }

  // ---- 생성(고정 순서: 방 → 고정 장치 → 표적 → 배치 물건 → 공) ----
  private build(): void {
    const surface = { friction: SURFACE_FRICTION, restitution: SURFACE_RESTITUTION };
    for (const f of [...ROOM_WALLS, ...this.level.fixed]) {
      const size = fixedSize(f);
      const b = this.world.createBody({ type: 'static', position: Vec2(f.pos[0], f.pos[1]), angle: f.rot * DEG });
      b.createFixture(Box(size[0] / 2, size[1] / 2), surface);
      b.setUserData({ kind: f.type, id: f.id } satisfies Tag);
      if (f.type === 'bumper') this.addBumper(f.id, b, f.rot);
    }
    for (const g of this.level.goals) {
      const s = goalSize(g);
      const b = this.world.createBody({ type: 'dynamic', position: Vec2(g.pos[0], g.pos[1]), angle: 0 });
      b.createFixture(Box(s[0] / 2, s[1] / 2), { density: 1.2, friction: 0.6, restitution: 0.1 });
      b.setUserData({ kind: 'target', id: g.id } satisfies Tag);
      this.targets.push({ def: g, body: b, holdSteps: 0, done: false, hit: false });
      this.replayBodies.push(b);
    }
    const placements = [...this.edit.placements].sort((a, b) => a.uid - b.uid);
    for (const p of placements) {
      const size = placeableSize(p.type);
      const b = this.world.createBody({ type: 'static', position: Vec2(p.pos[0], p.pos[1]), angle: p.rot * DEG });
      b.createFixture(Box(size[0] / 2, size[1] / 2), surface);
      const id = `p${p.uid}`;
      b.setUserData({ kind: p.type, id } satisfies Tag);
      if (p.type === 'bumper') this.addBumper(id, b, p.rot);
    }
  }

  private addBumper(id: string, body: Body, rot: number): void {
    const a = (rot + 90) * DEG;
    this.bumpers.set(id, { id, body, dir: [Math.cos(a), Math.sin(a)], cooldownUntil: -1 });
  }

  private fire(): void {
    const { cannon } = this.level;
    const a = this.edit.cannonAngle * DEG;
    const x = cannon.pos[0] + Math.cos(a) * CANNON_BARREL;
    const y = cannon.pos[1] + Math.sin(a) * CANNON_BARREL;
    const speed = Math.min(cannon.speed, BALL_MAX_SPEED);
    const ball = this.world.createBody({
      type: 'dynamic',
      position: Vec2(x, y),
      bullet: true, // 빠른 물체 연속 충돌 검사(6.4)
      linearDamping: 0.02,
      angularDamping: 1.2,
    });
    const area = Math.PI * BALL_RADIUS * BALL_RADIUS;
    ball.createFixture(Circle(BALL_RADIUS), { density: BALL_MASS / area, friction: SURFACE_FRICTION, restitution: 0.35 });
    ball.setUserData({ kind: 'ball', id: 'ball' } satisfies Tag);
    ball.setLinearVelocity(Vec2(Math.cos(a) * speed, Math.sin(a) * speed));
    this.ball = ball;
    this.replayBodies.unshift(ball);
    this.events.push({ t: 'fire', step: 0, x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
  }

  private replayMeta(): ReplayBodyMeta[] {
    return this.replayBodies.map((b) => {
      const t = b.getUserData() as Tag;
      return { id: t.id, kind: t.kind === 'ball' ? 'ball' : 'target' };
    });
  }

  // ---- 접촉 처리 ----
  private tags(c: Contact): [Tag, Tag, Fixture, Fixture] {
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    return [fa.getBody().getUserData() as Tag, fb.getBody().getUserData() as Tag, fa, fb];
  }

  private onBegin(c: Contact): void {
    const [a, b, fa, fb] = this.tags(c);
    this.pendingHits.push({ contact: c, a, b, impulse: 0 });
    for (const [me, other, otherFix] of [
      [a, b, fb],
      [b, a, fa],
    ] as const) {
      if (me.kind === 'bell' && !this.forbiddenHit && this.isForbidden(me.id)) {
        const p = otherFix.getBody().getPosition();
        this.forbiddenHit = { id: me.id, x: p.x, y: p.y };
      }
      if (me.kind === 'bumper' && other.kind === 'ball') {
        const bs = this.bumpers.get(me.id)!;
        const bp = bs.body.getPosition();
        const ball = otherFix.getBody().getPosition();
        const side = (ball.x - bp.x) * bs.dir[0] + (ball.y - bp.y) * bs.dir[1];
        if (side > 0 && this.step >= bs.cooldownUntil) this.pendingBoost = { id: me.id };
      }
      if (me.kind === 'target' && (other.kind === 'ball' || other.kind === 'target')) {
        const t = this.targets.find((x) => x.def.id === me.id)!;
        if (!t.hit && other.kind === 'ball') {
          t.hit = true;
          const p = t.body.getPosition();
          this.events.push({ t: 'targetHit', step: this.step, id: me.id, x: p.x, y: p.y });
        }
      }
    }
  }

  private isForbidden(id: string): boolean {
    return (this.level.forbidden ?? []).some((f) => f.type === 'touch' && f.target === id);
  }

  private onPostSolve(c: Contact, imp: ContactImpulse): void {
    for (const h of this.pendingHits) {
      if (h.contact === c) {
        const n = imp.normalImpulses;
        h.impulse = Math.max(h.impulse, (n[0] ?? 0) + (n[1] ?? 0));
      }
    }
  }

  // ---- 한 고정 단계 ----
  stepOnce(): void {
    if (this.finished) return;
    this.pendingHits = [];
    this.pendingBoost = null;
    this.world.step(STEP_DT, VELOCITY_ITERS, POSITION_ITERS);
    this.step++;
    this.afterStep();
    this.record();
  }

  private afterStep(): void {
    const s = this.step;
    // 충돌 이벤트(연출용 세기 포함). 공이 관여한 접촉만 기록
    for (const h of this.pendingHits) {
      if (h.a.kind !== 'ball' && h.b.kind !== 'ball' && !(h.a.kind === 'target' && h.b.kind === 'target')) continue;
      if (h.impulse < 0.15) continue;
      const wm = h.contact.getWorldManifold(null);
      const pt = wm?.points[0];
      const ballPos = this.ball?.getPosition();
      const x = pt ? pt.x : ballPos?.x ?? 0;
      const y = pt ? pt.y : ballPos?.y ?? 0;
      this.events.push({ t: 'hit', step: s, x, y, impulse: h.impulse, a: h.a.kind, b: h.b.kind });
    }
    // 쿠션: 정해진 방향·속도(5.2)
    if (this.pendingBoost && this.ball) {
      const bs = this.bumpers.get(this.pendingBoost.id)!;
      const v = Math.min(BUMPER_SPEED, BALL_MAX_SPEED);
      this.ball.setLinearVelocity(Vec2(bs.dir[0] * v, bs.dir[1] * v));
      this.ball.setAngularVelocity(0);
      bs.cooldownUntil = s + stepsOf(BUMPER_COOLDOWN);
      const p = this.ball.getPosition();
      this.events.push({ t: 'bumper', step: s, x: p.x, y: p.y, id: bs.id, vx: bs.dir[0] * v, vy: bs.dir[1] * v });
      const bp = bs.body.getPosition();
      this.lastDevice = { x: bp.x, y: bp.y, kind: 'device', label: 'bumper' };
    }
    // 공 최대 속도, 화면 밖 이탈
    if (this.ball) {
      const v = this.ball.getLinearVelocity();
      const sp = Math.hypot(v.x, v.y);
      if (sp > BALL_MAX_SPEED) this.ball.setLinearVelocity(Vec2((v.x / sp) * BALL_MAX_SPEED, (v.y / sp) * BALL_MAX_SPEED));
      const p = this.ball.getPosition();
      this.trackClosest(p.x, p.y);
      this.checkRing(p.x, p.y);
      if (p.x < -0.6 || p.x > WORLD_W + 0.6 || p.y < -0.6 || p.y > 30) {
        this.events.push({ t: 'ballLost', step: s, x: p.x, y: p.y });
        this.world.destroyBody(this.ball);
        this.ball = null;
      }
    }
    // 쓰러지는 표적: 지정 방향 45도 이상 0.2초 유지(4.3)
    const need = stepsOf(KNOCKDOWN_HOLD);
    for (const t of this.targets) {
      if (t.done) continue;
      const a = normRad(t.body.getAngle()) / DEG;
      const ok =
        t.def.dir === 'right' ? a <= -KNOCKDOWN_ANGLE_DEG : t.def.dir === 'left' ? a >= KNOCKDOWN_ANGLE_DEG : Math.abs(a) >= KNOCKDOWN_ANGLE_DEG;
      t.holdSteps = ok ? t.holdSteps + 1 : 0;
      if (t.holdSteps >= need) {
        t.done = true;
        const p = t.body.getPosition();
        this.events.push({ t: 'targetDown', step: s, id: t.def.id, x: p.x, y: p.y });
        this.lastDevice = { x: p.x, y: p.y, kind: 'target', label: t.def.id };
      }
    }
    if (s === this.timeLimitSteps - stepsOf(TIME_WARNING_BEFORE)) this.events.push({ t: 'timeWarning', step: s });

    // ---- 판정. 같은 단계에서 성공과 금지가 겹치면 실패 우선(4.4) ----
    if (this.forbiddenHit) {
      const f = this.forbiddenHit;
      this.events.push({ t: 'forbidden', step: s, id: f.id, x: f.x, y: f.y });
      return this.finish('fail', 'forbidden', { x: f.x, y: f.y, kind: 'forbidden', label: f.id });
    }
    const allDone = this.targets.every((t) => t.done);
    if (allDone) {
      if (this.allDoneAt < 0) this.allDoneAt = s;
      if (s - this.allDoneAt >= stepsOf(WIN_GRACE)) return this.finish('win');
      return; // 판정 유예 중에는 시간 초과로 실패시키지 않음
    }
    if (s >= this.timeLimitSteps) return this.finish('fail', 'timeout', this.failFocus());
    this.restSteps = this.atRest() ? this.restSteps + 1 : 0;
    const holding = this.targets.some((t) => !t.done && t.holdSteps > 0);
    if (this.restSteps >= stepsOf(REST_HOLD) && !holding) this.finish('fail', 'stalled', this.failFocus());
  }

  private atRest(): boolean {
    const bodies: Body[] = this.targets.map((t) => t.body);
    if (this.ball) bodies.push(this.ball);
    for (const b of bodies) {
      if (!b.isAwake()) continue;
      const v = b.getLinearVelocity();
      if (Math.hypot(v.x, v.y) > REST_LIN || Math.abs(b.getAngularVelocity()) > REST_ANG) return false;
    }
    return true;
  }

  private trackClosest(x: number, y: number): void {
    for (const t of this.targets) {
      if (t.done) continue;
      const p = t.body.getPosition();
      const d = Math.hypot(p.x - x, p.y - y);
      if (!this.closest || d < this.closest.d) this.closest = { d, x, y, id: t.def.id };
    }
  }

  private checkRing(x: number, y: number): void {
    const r = this.level.bonusGoal;
    if (!r || this.ringPassed) return;
    const dx = x - r.pos[0];
    const dy = y - r.pos[1];
    if (r.dir === undefined) {
      if (Math.hypot(dx, dy) <= RING_HALF) this.passRing(x, y);
      return;
    }
    const d: Vec = [Math.cos(r.dir * DEG), Math.sin(r.dir * DEG)];
    const along = dx * d[0] + dy * d[1];
    const across = Math.abs(-dx * d[1] + dy * d[0]);
    const side = along < 0 ? -1 : 1;
    if (this.ringPrevSide === -1 && side === 1 && across <= RING_HALF && Math.abs(along) < 0.6) this.passRing(x, y);
    this.ringPrevSide = side;
  }

  private passRing(x: number, y: number): void {
    this.ringPassed = true;
    this.events.push({ t: 'ring', step: this.step, id: this.level.bonusGoal!.id, x, y });
  }

  /** 마지막으로 의미 있게 작동한 지점(4.7) */
  private failFocus(): FocusPoint | undefined {
    const struck = this.targets.find((t) => t.hit && !t.done);
    if (struck) {
      const p = struck.body.getPosition();
      return { x: p.x, y: p.y, kind: 'target', label: struck.def.id };
    }
    if (this.closest) return { x: this.closest.x, y: this.closest.y, kind: 'trajectory', label: this.closest.id };
    return this.lastDevice ?? undefined;
  }

  private finish(status: 'win' | 'fail', reason?: FailReason, focus?: FocusPoint): void {
    this.finished = true;
    const goalsDone = this.targets.filter((t) => t.done).map((t) => t.def.id);
    let stars = 0;
    if (status === 'win') {
      stars = 1;
      if (!this.level.bonusGoal || this.ringPassed) stars++;
      if (this.edit.placements.length <= this.level.starMaxObjects) stars++;
    }
    this.result = { status, step: this.step, goalsDone, ringPassed: this.ringPassed, stars };
    if (reason) this.result.reason = reason;
    if (focus) this.result.focus = focus;
    this.events.push(status === 'win' ? { t: 'win', step: this.step } : { t: 'fail', step: this.step, reason: reason! });
  }

  private record(): void {
    if (!this.replay) return;
    const f = new Float32Array(this.replayBodies.length * 3);
    this.replayBodies.forEach((b, i) => {
      const alive = b === this.ball || (b.getUserData() as Tag).kind !== 'ball';
      const p = b.getPosition();
      f[i * 3] = alive ? p.x : NaN;
      f[i * 3 + 1] = alive ? p.y : NaN;
      f[i * 3 + 2] = alive ? b.getAngle() : NaN;
    });
    this.replay.frames.push(f);
  }

  // ---- 조회 ----
  bodies(): BodyView[] {
    const out: BodyView[] = [];
    if (this.ball) {
      const p = this.ball.getPosition();
      const v = this.ball.getLinearVelocity();
      out.push({ id: 'ball', kind: 'ball', x: p.x, y: p.y, angle: this.ball.getAngle(), vx: v.x, vy: v.y });
    }
    for (const t of this.targets) {
      const p = t.body.getPosition();
      const v = t.body.getLinearVelocity();
      out.push({ id: t.def.id, kind: 'target', x: p.x, y: p.y, angle: t.body.getAngle(), vx: v.x, vy: v.y, done: t.done });
    }
    return out;
  }

  goalsDone(): number {
    return this.targets.filter((t) => t.done).length;
  }

  ringDone(): boolean {
    return this.ringPassed;
  }

  /** 결정성 검사용 전체 상태 문자열(위치·각도·속도 원값) */
  stateHash(): string {
    const parts: string[] = [String(this.step)];
    for (const b of this.replayBodies) {
      if ((b.getUserData() as Tag).kind === 'ball' && b !== this.ball) {
        parts.push('lost');
        continue;
      }
      const p = b.getPosition();
      const v = b.getLinearVelocity();
      parts.push([p.x, p.y, b.getAngle(), v.x, v.y, b.getAngularVelocity()].join(','));
    }
    return parts.join('|');
  }

  run(maxSteps = 60 * 60): SimResult {
    while (!this.finished && this.step < maxSteps) this.stepOnce();
    if (!this.finished) this.finish('fail', 'timeout', this.failFocus());
    return this.result!;
  }
}

function normRad(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

/** 공 없이 장치만 놓인 발사 직전 월드 상태 해시(재배치 복원 검사용) */
export function initialStateHash(level: LevelData, edit: EditState): string {
  return new Simulation(level, edit).stateHash();
}
