// 방·장치·공·표적 화면. 미터 좌표(원점 왼쪽 아래, y 위)를 논리 픽셀로 바꿔 그린다(1m = 80px).
import { Container, Graphics, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { BALL_RADIUS, CANNON_BARREL, PX_PER_M, RING_HALF, WORLD_H, WORLD_W } from '../core/constants';
import { DEG } from '../core/geometry';
import { fixedSize, goalSize, placeableSize } from '../core/level';
import type { BodyView } from '../core/sim';
import type { EditState, FixedDef, LevelData, Placement, PlaceableType, Vec } from '../core/types';
import type { Art } from './art';
import { easeOutBack } from './fx';

export const PLAY_W = WORLD_W * PX_PER_M; // 384
export const PLAY_H = WORLD_H * PX_PER_M; // 640

export const toPx = (x: number, y: number): [number, number] => [x * PX_PER_M, (WORLD_H - y) * PX_PER_M];
export const toM = (px: number, py: number): Vec => [px / PX_PER_M, WORLD_H - py / PX_PER_M];

const WALL_COLORS = [0xffb4c8, 0xa8dcf0, 0xffd98a, 0xb9e4b5, 0xd5c0ff];

/** 텍스처를 주어진 픽셀 크기에 맞춰 늘림 */
function fit(s: Sprite, w: number, h: number): Sprite {
  s.anchor.set(0.5);
  s.width = w;
  s.height = h;
  return s;
}

interface PlacementNode {
  c: Container;
  body: Container;
  outline: Graphics;
  type: PlaceableType;
  squash: number;
}

interface TargetNode {
  c: Container;
  spr: Sprite | Graphics;
  hitFlash: number;
  pop: number;
  done: boolean;
  wobble: number;
}

export class WorldView {
  readonly root = new Container();
  readonly bg = new Container();
  readonly staticLayer = new Container();
  readonly areaLayer = new Container();
  readonly previewLayer = new Graphics();
  readonly placeLayer = new Container();
  readonly dynLayer = new Container();
  readonly fxSlot = new Container();
  readonly overlay = new Container();
  readonly trail = new Graphics();

  private readonly placements = new Map<number, PlacementNode>();
  private readonly targets = new Map<string, TargetNode>();
  private readonly bumperNodes = new Map<string, Container>();
  private cannon!: Container;
  private barrel!: Container;
  private recoil = 0;
  private ballWrap!: Container;
  private ballSpr!: Container;
  private ballSquash = 0;
  private ballSpin = 0;
  private trailPts: { x: number; y: number }[] = [];
  private ring: Container | null = null;
  private ringDone = 0;
  readonly handle = new Graphics();
  readonly rotHandle = new Container();
  private t = 0;
  ringPos: [number, number] | null = null;

  constructor(private readonly art: Art) {
    this.root.addChild(this.bg, this.staticLayer, this.areaLayer, this.previewLayer, this.trail, this.placeLayer, this.dynLayer, this.fxSlot, this.overlay);
  }

  build(level: LevelData): void {
    for (const l of [this.bg, this.staticLayer, this.areaLayer, this.placeLayer, this.dynLayer, this.overlay]) l.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.placements.clear();
    this.targets.clear();
    this.bumperNodes.clear();
    this.trailPts = [];
    this.trail.clear();
    this.previewLayer.clear();

    // 플레이 영역 바탕: 부드러운 패널 + 바닥 띠
    const panel = new Graphics();
    panel.roundRect(-4, -4, PLAY_W + 8, PLAY_H + 8, 18).fill({ color: 0xffffff, alpha: 0.28 });
    panel.roundRect(-4, PLAY_H - 6, PLAY_W + 8, 22, 8).fill({ color: 0xe8b98a });
    panel.roundRect(-4, PLAY_H - 6, PLAY_W + 8, 6, 3).fill({ color: 0xf6d2ab });
    this.bg.addChild(panel);

    level.fixed.forEach((f, i) => this.staticLayer.addChild(this.fixedNode(f, i)));

    if (level.bonusGoal) {
      const r = new Container();
      const [x, y] = toPx(level.bonusGoal.pos[0], level.bonusGoal.pos[1]);
      r.position.set(x, y);
      const glow = new Graphics().circle(0, 0, RING_HALF * PX_PER_M + 8).fill({ color: 0xffe27a, alpha: 0.25 });
      r.addChild(glow);
      if (this.art.ring) r.addChild(fit(new Sprite(this.art.ring), RING_HALF * 2 * PX_PER_M, RING_HALF * 2 * PX_PER_M));
      else r.addChild(new Graphics().circle(0, 0, RING_HALF * PX_PER_M).stroke({ width: 7, color: 0xffc83d }));
      this.ring = r;
      this.ringPos = [x, y];
      this.ringDone = 0;
      this.staticLayer.addChild(r);
    } else {
      this.ring = null;
      this.ringPos = null;
    }

    // 표적
    for (const g of level.goals) {
      const c = new Container();
      const s = goalSize(g);
      const [px, py] = toPx(g.pos[0], g.pos[1]);
      c.position.set(px, py);
      let spr: Sprite | Graphics;
      if (this.art.target) {
        spr = new Sprite(this.art.target);
        spr.anchor.set(0.5, 0.5);
        const h = s[1] * PX_PER_M * 1.08;
        spr.scale.set(h / this.art.target.height);
      } else {
        spr = new Graphics().roundRect((-s[0] * PX_PER_M) / 2, (-s[1] * PX_PER_M) / 2, s[0] * PX_PER_M, s[1] * PX_PER_M, 10).fill(0xc9a2ff);
      }
      c.addChild(spr);
      if (g.dir !== 'any') {
        const arrow = new Graphics();
        const d = g.dir === 'right' ? 1 : -1;
        arrow.moveTo(0, 0).lineTo(16 * d, 0).stroke({ width: 4, color: 0xffffff, cap: 'round' });
        arrow.poly([16 * d, -6, 24 * d, 0, 16 * d, 6]).fill(0xffffff);
        arrow.position.set(0, (-s[1] * PX_PER_M) / 2 - 14);
        arrow.alpha = 0.9;
        c.addChild(arrow);
      }
      this.dynLayer.addChild(c);
      this.targets.set(g.id, { c, spr, hitFlash: 0, pop: 0, done: false, wobble: 0 });
    }

    // 대포
    this.cannon = new Container();
    const [cx, cy] = toPx(level.cannon.pos[0], level.cannon.pos[1]);
    this.cannon.position.set(cx, cy);
    this.barrel = new Container();
    const barrelLen = (CANNON_BARREL + 0.22) * PX_PER_M;
    if (this.art.barrel) {
      const b = new Sprite(this.art.barrel);
      b.anchor.set(0.22, 0.5);
      b.width = barrelLen;
      b.height = 30;
      this.barrel.addChild(b);
    } else {
      this.barrel.addChild(new Graphics().roundRect(-12, -14, barrelLen, 28, 12).fill(0xff8f8f));
    }
    const base = this.art.base ? fit(new Sprite(this.art.base), 64, 36) : new Graphics().roundRect(-30, -10, 60, 30, 12).fill(0x8fc1ff);
    base.position.set(0, 14);
    this.cannon.addChild(this.barrel, base);
    this.staticLayer.addChild(this.cannon);

    // 대포 조준 손잡이
    this.handle.clear();
    this.handle.circle(0, 0, 17).fill({ color: 0xffffff, alpha: 0.95 }).stroke({ width: 4, color: 0xff7aa2 });
    this.handle.circle(0, 0, 6).fill(0xff7aa2);
    this.overlay.addChild(this.handle);

    // 회전 손잡이
    this.rotHandle.removeChildren();
    const rh = new Graphics();
    rh.circle(0, 0, 15).fill({ color: 0xffffff }).stroke({ width: 3, color: 0x6b8cff });
    rh.arc(0, 0, 8, -Math.PI * 0.9, Math.PI * 0.4).stroke({ width: 3, color: 0x6b8cff });
    rh.poly([7, 2, 12, -3, 3, -4]).fill(0x6b8cff);
    this.rotHandle.addChild(rh);
    this.rotHandle.visible = false;
    this.overlay.addChild(this.rotHandle);

    // 공
    this.ballWrap = new Container();
    const d = BALL_RADIUS * 2 * PX_PER_M;
    this.ballSpr = new Container();
    this.ballSpr.addChild(this.art.ball ? fit(new Sprite(this.art.ball), d, d) : new Graphics().circle(0, 0, d / 2).fill(0xffd166));
    this.ballWrap.addChild(this.ballSpr);
    this.ballWrap.visible = false;
    this.dynLayer.addChild(this.ballWrap);
  }

  private fixedNode(f: FixedDef, i: number): Container {
    const c = new Container();
    const [x, y] = toPx(f.pos[0], f.pos[1]);
    c.position.set(x, y);
    c.rotation = -f.rot * DEG;
    const [w, h] = fixedSize(f).map((v) => v * PX_PER_M) as [number, number];
    if (f.type === 'wall') {
      const col = WALL_COLORS[i % WALL_COLORS.length]!;
      const g = new Graphics();
      g.roundRect(-w / 2 + 2, -h / 2 + 4, w, h, Math.min(10, w / 2, h / 2)).fill({ color: 0x6d4c7d, alpha: 0.18 });
      g.roundRect(-w / 2, -h / 2, w, h, Math.min(10, w / 2, h / 2)).fill(col).stroke({ width: 2.5, color: darken(col, 0.25) });
      const hl = Math.min(6, h / 3);
      if (w > 10 && h > 10) g.roundRect(-w / 2 + 4, -h / 2 + 3, w - 8, hl, hl / 2).fill({ color: 0xffffff, alpha: 0.45 });
      // 고정 장치 표시: 나사 점
      if (w > 30 && h >= 14) for (const sx of [-w / 2 + 8, w / 2 - 8]) g.circle(sx, 0, 2.5).fill({ color: darken(col, 0.35) });
      c.addChild(g);
    } else if (f.type === 'bell') {
      const g = new Graphics();
      g.circle(0, 4, w / 2).fill(0xffd34d).stroke({ width: 3, color: 0xc28a00 });
      g.circle(0, h / 2 - 4, 5).fill(0xc28a00);
      g.rect(-3, -h / 2 - 2, 6, 8).fill(0xc28a00);
      c.addChild(g);
      const warn = new Graphics().circle(0, 0, w / 2 + 10).stroke({ width: 2, color: 0xff5a5a, alpha: 0.7 });
      c.addChild(warn);
    } else {
      c.addChild(this.deviceBody(f.type, true));
      if (f.type === 'bumper') this.bumperNodes.set(f.id, c.children[0] as Container);
    }
    return c;
  }

  /** 경사로·쿠션 그림. fixed=true면 받침(나사) 표시로 배치 가능 물건과 구분(3장) */
  deviceBody(type: PlaceableType, fixed: boolean): Container {
    const [w, h] = placeableSize(type).map((v) => v * PX_PER_M) as [number, number];
    const c = new Container();
    const tex: Texture | undefined = type === 'ramp' ? this.art.ramp : this.art.bumper;
    if (tex) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.width = w + 4;
      s.height = type === 'ramp' ? h + 4 : h + 8;
      c.addChild(s);
    } else {
      const col = type === 'ramp' ? 0x7ad7c4 : 0xff6fa8;
      c.addChild(new Graphics().roundRect(-w / 2, -h / 2, w, h, h / 2).fill(col));
    }
    if (fixed) {
      const g = new Graphics();
      for (const sx of [-w / 2 + 7, w / 2 - 7]) g.circle(sx, 0, 2.6).fill(0x5b4a6b).stroke({ width: 1, color: 0xffffff });
      c.addChild(g);
    }
    return c;
  }

  // ---- 편집 상태 표시 ----
  showAreas(level: LevelData, visible: boolean, highlight?: PlaceableType): void {
    this.areaLayer.removeChildren().forEach((c) => c.destroy());
    if (!visible) return;
    for (const def of level.placeable) {
      const g = new Graphics();
      const on = highlight === def.type;
      const col = def.type === 'ramp' ? 0x3fbfa6 : 0xff5c9a;
      if (def.area === 'sockets') {
        for (const s of def.sockets ?? []) {
          const [x, y] = toPx(s[0], s[1]);
          g.circle(x, y, on ? 20 : 15).fill({ color: col, alpha: on ? 0.28 : 0.14 }).stroke({ width: 2, color: col, alpha: 0.7 });
          g.circle(x, y, 3).fill({ color: col, alpha: 0.8 });
        }
      } else if (def.bounds) {
        const [a, b] = def.bounds;
        const [x0, y0] = toPx(a[0], b[1]);
        const [x1, y1] = toPx(b[0], a[1]);
        dashedRect(g, x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12, col, on ? 0.9 : 0.4);
        g.roundRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12, 12).fill({ color: col, alpha: on ? 0.1 : 0.04 });
      }
      this.areaLayer.addChild(g);
    }
  }

  syncPlacements(edit: EditState, problems: Set<number>, selected: number | null, lifted: number | null): void {
    const seen = new Set<number>();
    for (const p of edit.placements) {
      seen.add(p.uid);
      let n = this.placements.get(p.uid);
      if (!n) {
        const c = new Container();
        const body = this.deviceBody(p.type, false);
        const outline = new Graphics();
        c.addChild(outline, body);
        this.placeLayer.addChild(c);
        n = { c, body, outline, type: p.type, squash: 1 };
        this.placements.set(p.uid, n);
      }
      const [x, y] = toPx(p.pos[0], p.pos[1]);
      n.c.position.set(x, y - (lifted === p.uid ? 6 : 0));
      n.c.rotation = -p.rot * DEG;
      const [w, h] = placeableSize(p.type).map((v) => v * PX_PER_M) as [number, number];
      n.outline.clear();
      const bad = problems.has(p.uid);
      const sel = selected === p.uid;
      const col = bad ? 0xff3b5c : sel ? 0x6b8cff : 0xffffff;
      n.outline.roundRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, (h + 10) / 2).stroke({ width: bad || sel ? 3.5 : 2.5, color: col, alpha: bad || sel ? 1 : 0.85 });
      if (lifted === p.uid) {
        n.outline.roundRect(-w / 2 + 3, -h / 2 + 12, w, h, h / 2).fill({ color: 0x000000, alpha: 0.12 });
      }
    }
    for (const [uid, n] of this.placements) {
      if (!seen.has(uid)) {
        n.c.destroy({ children: true });
        this.placements.delete(uid);
      }
    }
  }

  placementNode(uid: number): Container | undefined {
    return this.placements.get(uid)?.c;
  }

  popPlacement(uid: number): void {
    const n = this.placements.get(uid);
    if (n) n.squash = 0.6;
  }

  rotHandlePos(p: Placement): [number, number] {
    const r = (placeableSize(p.type)[0] / 2 + 0.28) * PX_PER_M;
    const [x, y] = toPx(p.pos[0], p.pos[1]);
    return [x + Math.cos(-p.rot * DEG) * r, y + Math.sin(-p.rot * DEG) * r];
  }

  setRotHandle(p: Placement | null): void {
    this.rotHandle.visible = !!p;
    if (p) this.rotHandle.position.set(...this.rotHandlePos(p));
  }

  setCannon(angleDeg: number, showHandle: boolean): void {
    this.barrel.rotation = -angleDeg * DEG;
    this.handle.visible = showHandle;
    const [cx, cy] = [this.cannon.x, this.cannon.y];
    const r = (CANNON_BARREL + 0.45) * PX_PER_M;
    this.handle.position.set(cx + Math.cos(-angleDeg * DEG) * r, cy + Math.sin(-angleDeg * DEG) * r);
  }

  cannonHandlePos(): [number, number] {
    return [this.handle.x, this.handle.y];
  }
  cannonPos(): [number, number] {
    return [this.cannon.x, this.cannon.y];
  }

  drawPreview(path: Vec[], alpha: number): void {
    const g = this.previewLayer;
    g.clear();
    path.forEach((p, i) => {
      if (i % 3 !== 0 || i === 0) return;
      const [x, y] = toPx(p[0], p[1]);
      const k = i / path.length;
      g.circle(x, y, 4.2 - k * 2).fill({ color: 0xffffff, alpha: alpha * (1 - k * 0.7) });
      g.circle(x, y, 4.2 - k * 2).stroke({ width: 1.5, color: 0xff7aa2, alpha: alpha * (1 - k * 0.7) });
    });
  }

  // ---- 시뮬레이션 화면 ----
  kickRecoil(): void {
    this.recoil = 1;
  }

  resetDynamic(level: LevelData): void {
    for (const g of level.goals) {
      const n = this.targets.get(g.id)!;
      const [x, y] = toPx(g.pos[0], g.pos[1]);
      n.c.position.set(x, y);
      n.c.rotation = 0;
      n.done = false;
      n.pop = 0;
      n.hitFlash = 0;
      n.c.scale.set(1);
      if (n.spr instanceof Sprite && this.art.target) n.spr.texture = this.art.target;
      n.spr.tint = 0xffffff;
    }
    this.ballWrap.visible = false;
    this.trailPts = [];
    this.trail.clear();
    if (this.ring) {
      this.ring.alpha = 1;
      this.ring.scale.set(1);
      this.ringDone = 0;
    }
  }

  setBodies(bodies: BodyView[] | { id: string; kind: 'ball' | 'target'; x: number; y: number; angle: number; vx: number; vy: number }[]): void {
    let ballSeen = false;
    for (const b of bodies) {
      const [x, y] = toPx(b.x, b.y);
      if (b.kind === 'ball') {
        ballSeen = true;
        this.ballWrap.visible = true;
        this.ballWrap.position.set(x, y);
        const sp = Math.hypot(b.vx, b.vy);
        const va = Math.atan2(-b.vy, b.vx);
        const st = Math.min(0.28, sp * 0.022) + this.ballSquash;
        this.ballWrap.rotation = va;
        this.ballWrap.scale.set(1 + st, 1 - st * 0.8);
        this.ballSpin = -b.angle;
        this.ballSpr.rotation = this.ballSpin - va;
        this.trailPts.push({ x, y });
        if (this.trailPts.length > 16) this.trailPts.shift();
      } else {
        const n = this.targets.get(b.id);
        if (!n) continue;
        n.c.position.set(x, y);
        n.c.rotation = -b.angle;
      }
    }
    if (!ballSeen) {
      this.ballWrap.visible = false;
      if (this.trailPts.length) this.trailPts.shift();
    }
  }

  ballScreen(): [number, number] | null {
    return this.ballWrap.visible ? [this.ballWrap.x, this.ballWrap.y] : null;
  }

  squashBall(k: number): void {
    this.ballSquash = -Math.min(0.35, k);
  }

  hitTarget(id: string): void {
    const n = this.targets.get(id);
    if (n) {
      n.hitFlash = 1;
      n.wobble = 1;
    }
  }

  downTarget(id: string): void {
    const n = this.targets.get(id);
    if (!n) return;
    n.done = true;
    n.pop = 1;
    if (n.spr instanceof Sprite && this.art.targetDown) n.spr.texture = this.art.targetDown;
  }

  bumpBumper(id: string): void {
    const n = this.bumperNodes.get(id) ?? (id.startsWith('p') ? this.placements.get(Number(id.slice(1)))?.body : undefined);
    if (n) (n as Container & { _sq?: number })._sq = 1;
  }

  passRing(): void {
    this.ringDone = 1;
  }

  targetScreen(id: string): [number, number] | null {
    const n = this.targets.get(id);
    return n ? [n.c.x, n.c.y] : null;
  }

  /** 연출 애니메이션(실제 시간 기준) */
  animate(dt: number): void {
    this.t += dt;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    const rk = this.recoil;
    const back = Math.sin(rk * Math.PI) * 9 * (rk > 0 ? 1 : 0);
    const r = this.barrel.rotation;
    this.barrel.position.set(-Math.cos(r) * back, -Math.sin(r) * back);
    this.barrel.scale.set(1 - rk * 0.12, 1 + rk * 0.18);
    this.ballSquash *= Math.exp(-dt * 14);
    this.handle.scale.set(1 + Math.sin(this.t * 5) * 0.06);

    for (const n of this.targets.values()) {
      n.hitFlash = Math.max(0, n.hitFlash - dt * 6);
      n.spr.tint = n.hitFlash > 0 ? lerpColor(0xffffff, 0xfff1a8, n.hitFlash) : 0xffffff;
      n.wobble = Math.max(0, n.wobble - dt * 3);
      let sx = 1 + Math.sin(this.t * 30) * 0.08 * n.wobble;
      let sy = 1 - Math.sin(this.t * 30) * 0.08 * n.wobble;
      if (n.pop > 0) {
        n.pop = Math.max(0, n.pop - dt * 3);
        const k = easeOutBack(1 - n.pop);
        sx *= 0.75 + 0.25 * k;
        sy *= 1.3 - 0.3 * k;
      }
      n.c.scale.set(sx, sy);
    }
    for (const n of this.placements.values()) {
      n.squash += (1 - n.squash) * Math.min(1, dt * 14);
      n.body.scale.set(2 - n.squash, n.squash);
    }
    const sqNodes = [...this.bumperNodes.values(), ...[...this.placements.values()].filter((p) => p.type === 'bumper').map((p) => p.body)];
    for (const b of sqNodes) {
      const bb = b as Container & { _sq?: number };
      if (bb._sq && bb._sq > 0) {
        bb._sq = Math.max(0, bb._sq - dt * 4);
        const k = bb._sq;
        b.scale.set(1 + Math.sin(k * 14) * 0.18 * k, 1 - Math.sin(k * 14) * 0.35 * k);
      }
    }
    if (this.ring) {
      if (this.ringDone > 0) {
        this.ringDone = Math.min(2, this.ringDone + dt * 3);
        const k = Math.min(1, this.ringDone - 1);
        this.ring.scale.set(1 + Math.max(0, this.ringDone - 1) * 0.6);
        this.ring.alpha = 1 - Math.max(0, k);
      } else {
        this.ring.scale.set(1 + Math.sin(this.t * 3) * 0.05);
        this.ring.rotation = Math.sin(this.t * 1.7) * 0.15;
      }
    }
    // 공 꼬리
    const g = this.trail;
    g.clear();
    const n = this.trailPts.length;
    for (let i = 1; i < n; i++) {
      const a = this.trailPts[i - 1]!;
      const b = this.trailPts[i]!;
      const k = i / n;
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3 + k * 13, color: 0xfff3b0, alpha: k * 0.55, cap: 'round' });
    }
  }
}

function dashedRect(g: Graphics, x: number, y: number, w: number, h: number, col: number, alpha: number): void {
  const dash = 8;
  const gap = 6;
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.moveTo(x0 + ux * d, y0 + uy * d).lineTo(x0 + ux * e, y0 + uy * e);
    }
  };
  seg(x, y, x + w, y);
  seg(x + w, y, x + w, y + h);
  seg(x + w, y + h, x, y + h);
  seg(x, y + h, x, y);
  g.stroke({ width: 2.5, color: col, alpha, cap: 'round' });
}

export function darken(c: number, k: number): number {
  const r = ((c >> 16) & 255) * (1 - k);
  const g = ((c >> 8) & 255) * (1 - k);
  const b = (c & 255) * (1 - k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
