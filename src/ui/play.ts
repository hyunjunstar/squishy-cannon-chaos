// 플레이 화면: 편집(배치·회전·조준) → 발사 → 관찰 → 재배치, 결과·리플레이(3장, 4장, 6.5).
import { Container, Graphics } from 'pixi.js';
import { PX_PER_M } from '../core/constants';
import { DEG } from '../core/geometry';
import { placementPoly, placementProblem, remaining, snapToArea, solutionEdit } from '../core/level';
import { previewPath } from '../core/preview';
import { Session } from '../core/session';
import type { EditState, LevelData, PlaceableType, Placement, SimEvent, Vec } from '../core/types';
import { sfx, unlock } from '../platform/audio';
import { buzz } from '../platform/haptics';
import { writeSave } from '../platform/storage';
import type { SaveData } from '../platform/storage';
import { Director } from '../render/director';
import { Fx } from '../render/fx';
import { ReplayPlayer } from '../render/replay_player';
import { PLAY_H, PLAY_W, WorldView, toM, toPx } from '../render/world_view';
import type { GameCtx } from './ctx';
import { el, icon } from './dom';

export const PLAY_X = 3;
export const PLAY_Y = 66;
const BOTTOM_Y = 844 - 132;

const INFO: Record<string, string> = {
  ramp: '<b>경사로</b><br>공이 굴러가는 방향을 바꿔요. 회전 손잡이로 기울여 보세요.',
  bumper: '<b>탄성 쿠션</b><br>공이 윗면에 닿으면 화살표 방향으로 일정한 힘으로 튕겨 내요.',
  cannon: '<b>장난감 대포</b><br>손잡이를 끌어 각도를 바꿔요. 공은 한 발!',
};

type Mode =
  | { k: 'none' }
  | { k: 'aim'; start: number }
  | { k: 'drag'; uid: number; startPos: Vec; lastValid: Vec | null; moved: boolean; sx: number; sy: number; touch: boolean; fresh: boolean }
  | { k: 'rotate'; uid: number; start: number };

export class PlayScreen {
  readonly session: Session;
  readonly view: WorldView;
  readonly fx: Fx;
  readonly cam = new Container();
  private readonly director: Director;
  private readonly dom: HTMLElement;
  private readonly ui: Record<string, HTMLElement> = {};
  private mode: Mode = { k: 'none' };
  private selected: number | null = null;
  private evIdx = 0;
  private dirty = true;
  private longTimer = 0;
  private failMarker = new Graphics();
  private hintGhost = new Graphics();
  private failT = 0;
  private failPath: [number, number][] = [];
  private replay: ReplayPlayer | null = null;
  private resultT = 0;
  private winDelay = -1;
  private camZoom = 1;
  private camTarget = { x: 0, y: 0, s: 1 };
  private camCur = { x: 0, y: 0, s: 1 };
  private toastTimer = 0;
  private fails = 0;
  private tutorialShown = false;
  destroyed = false;
  /** 마지막 결과(테스트용) */
  lastHash = '';

  constructor(
    private readonly ctx: GameCtx,
    readonly index: number,
    private readonly save: SaveData,
  ) {
    const level = ctx.levels[index]!;
    const snap = save.editSnapshot?.levelId === level.levelId ? save.editSnapshot.edit : undefined;
    this.session = new Session(level, snap);
    this.session.speed = save.settings.speed;
    this.view = new WorldView(ctx.art);
    this.view.build(level);
    this.fx = new Fx(ctx.fxTex, PLAY_W, PLAY_H);
    this.fx.enabled = ctx.effects;
    this.view.fxSlot.addChild(this.fx.layer);
    this.view.overlay.addChild(this.failMarker, this.hintGhost);
    this.view.root.addChild(this.fx.top);
    this.view.root.position.set(PLAY_X, PLAY_Y);
    this.cam.addChild(this.view.root);
    ctx.stage.addChild(this.cam);
    this.director = new Director(this.view, this.fx, level.goals.length, {
      onGoal: (d, t) => this.updateGoal(d, t, true),
      onTimeWarning: () => this.toast('3초 남았어요!', 'warn', 1500),
    });
    this.dom = this.buildDom(level);
    ctx.overlay.appendChild(this.dom);
    this.bindInput();
    this.enterEdit();
  }

  get level(): LevelData {
    return this.session.level;
  }

  // ---------------- DOM ----------------
  private buildDom(level: LevelData): HTMLElement {
    const root = el('div', 'layer play');
    const top = el('div', 'hud-top');
    const pause = el('button', 'btn icon-btn', '', { 'data-id': 'pause', 'aria-label': '일시정지' });
    pause.appendChild(icon('ui_pause_default'));
    pause.onclick = () => this.ctx.pauseMenu(this);
    const lv = el('div', 'pill level', `<b>${this.index + 1}</b>${level.name ?? ''}`);
    const goal = el('div', 'pill goal', '', { 'data-id': 'goal' });
    goal.appendChild(icon('target_knockdown_default'));
    goal.appendChild(el('span', 'num', `0/${level.goals.length}`));
    const hint = el('button', 'btn pill tokens', '', { 'data-id': 'hint', 'aria-label': '힌트' });
    hint.appendChild(icon('ui_hint_default'));
    hint.appendChild(el('span', 'num', String(this.save.hintTokens)));
    hint.onclick = () => this.ctx.hintMenu(this);
    top.append(pause, lv, goal, hint);
    this.ui.goal = goal;
    this.ui.hint = hint;

    const bottom = el('div', 'bottom');
    const drawer = el('div', 'drawer');
    this.ui.drawer = drawer;
    const aux = el('div', 'aux');
    const undo = this.iconButton('ui_undo_default', 'undo', '되돌리기', () => {
      if (this.session.undo()) {
        sfx.click();
        this.select(null);
        this.changed();
      }
    });
    const reset = this.iconButton('ui_restore_default', 'reset', '초기화', () => {
      this.session.resetAll();
      sfx.click();
      this.select(null);
      this.changed();
    });
    const speed = el('button', 'btn speed', '2x', { 'data-id': 'speed', 'aria-label': '2배속' });
    speed.onclick = () => {
      this.session.toggleSpeed();
      this.save.settings.speed = this.session.speed;
      writeSave(this.save);
      sfx.click();
      this.refresh();
    };
    aux.append(undo, reset, speed);
    const fire = el('button', 'btn fire', '', { 'data-id': 'fire' });
    fire.onclick = () => this.onFire();
    this.ui.fire = fire;
    this.ui.undo = undo;
    this.ui.reset = reset;
    this.ui.speed = speed;
    bottom.append(drawer, aux, fire);

    const sel = el('div', 'seltools hidden');
    const rl = this.smallBtn('ui_rotate_left', 'rotl', () => this.rotateSelected(15));
    const rr = this.smallBtn('ui_rotate_right', 'rotr', () => this.rotateSelected(-15));
    const del = el('button', 'btn del', '✕', { 'data-id': 'del', 'aria-label': '빼기' });
    del.onclick = () => {
      if (this.selected !== null && this.session.remove(this.selected)) {
        sfx.drop(true);
        this.select(null);
        this.changed();
      }
    };
    sel.append(rl, rr, del);
    this.ui.sel = sel;
    root.append(top, bottom, sel);
    return root;
  }

  private iconButton(img: string, id: string, label: string, fn: () => void): HTMLElement {
    const b = el('button', 'btn icon-btn', '', { 'data-id': id, 'aria-label': label });
    b.appendChild(icon(img));
    b.appendChild(el('span', 'lbl', label));
    b.onclick = fn;
    return b;
  }
  private smallBtn(img: string, id: string, fn: () => void): HTMLElement {
    const b = el('button', 'btn', '', { 'data-id': id });
    b.appendChild(icon(img));
    b.onclick = fn;
    return b;
  }

  private renderDrawer(): void {
    const d = this.ui.drawer!;
    d.innerHTML = '';
    if (!this.level.placeable.length) {
      d.appendChild(el('div', 'empty', '이번엔 대포만!<br>각도를 맞춰 쏴 보세요'));
      return;
    }
    for (const def of this.level.placeable) {
      const left = remaining(this.level, this.session.edit, def.type);
      const card = el('div', `card${left <= 0 ? ' zero' : ''}`, '', { 'data-type': def.type });
      card.appendChild(icon(def.type === 'ramp' ? 'device_ramp_default' : 'device_bumper_default'));
      card.appendChild(el('span', 'cnt', String(left)));
      card.addEventListener('pointerdown', (e) => this.onCardDown(e, def.type));
      d.appendChild(card);
    }
  }

  toast(text: string, kind = '', ms = 2200): void {
    this.ui.toast?.remove();
    const t = el('div', `toast ${kind}`, text);
    this.dom.appendChild(t);
    this.ui.toast = t;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.remove(), ms);
  }

  private updateGoal(done: number, total: number, bump: boolean): void {
    const g = this.ui.goal!;
    g.querySelector('.num')!.textContent = `${done}/${total}`;
    g.classList.toggle('all', done >= total);
    if (bump) {
      g.classList.remove('bump');
      void g.offsetWidth;
      g.classList.add('bump');
    }
  }

  refreshTokens(): void {
    this.ui.hint!.querySelector('.num')!.textContent = String(this.save.hintTokens);
  }

  private refresh(): void {
    const s = this.session;
    const editing = s.phase === 'edit';
    const fire = this.ui.fire!;
    fire.innerHTML = '';
    fire.classList.toggle('retry', !editing);
    fire.classList.remove('glow');
    if (editing) {
      fire.appendChild(icon('ui_fire_default'));
      fire.appendChild(document.createTextNode('발사'));
    } else {
      fire.appendChild(icon('ui_retry_default'));
      fire.appendChild(document.createTextNode('재배치'));
    }
    (this.ui.undo as HTMLButtonElement).disabled = !s.canUndo();
    (this.ui.reset as HTMLButtonElement).disabled = !editing;
    this.ui.speed!.classList.toggle('on', s.speed === 2);
    this.ui.drawer!.style.opacity = editing ? '1' : '0.45';
    this.renderDrawer();
  }

  // ---------------- 상태 전환 ----------------
  private enterEdit(): void {
    this.view.resetDynamic(this.level);
    this.view.showAreas(this.level, this.level.placeable.length > 0);
    this.fx.clear();
    this.failMarker.clear();
    this.updateGoal(0, this.level.goals.length, false);
    this.dirty = true;
    this.refresh();
    if (!this.tutorialShown) this.tutorial();
  }

  private changed(): void {
    this.dirty = true;
    this.save.editSnapshot = { levelId: this.level.levelId, edit: this.session.edit };
    writeSave(this.save);
    this.refresh();
  }

  onFire(): void {
    unlock();
    const s = this.session;
    if (s.phase === 'edit') {
      const r = s.fire(true);
      if (!r.ok) {
        // 겹침 상태 발사 차단 + 문제 위치 표시(4.1)
        const f = this.ui.fire!;
        f.classList.remove('blocked');
        void f.offsetWidth;
        f.classList.add('blocked');
        sfx.drop(false);
        buzz(30);
        this.toast('물건이 겹쳐 있어요! 빨간 곳을 옮겨 주세요', 'warn');
        this.dirty = true;
        return;
      }
      this.select(null);
      this.hideTutorial();
      this.hintGhost.clear();
      this.view.showAreas(this.level, false);
      this.view.drawPreview([], 0);
      this.view.setCannon(s.edit.cannonAngle, false);
      this.view.setRotHandle(null);
      this.director.reset();
      this.evIdx = 0;
      this.winDelay = -1;
      this.refresh();
      this.syncSim();
    } else if (s.phase === 'running' || s.phase === 'done') {
      // 재배치: 언제든 즉시 중단 후 복구(실패로 기록 안 함)
      sfx.whoosh();
      s.retry();
      this.enterEdit();
      this.dirty = true;
      if (this.fails >= 5 && this.fails % 5 === 0) this.toast('막혔나요? 오른쪽 위 힌트를 눌러 보세요 💡', '', 2600);
    }
  }

  private syncSim(): void {
    const sim = this.session.sim;
    if (!sim) return;
    const ev = sim.events;
    while (this.evIdx < ev.length) this.director.react(ev[this.evIdx++]!);
    this.view.setBodies(sim.bodies());
  }

  private onFinished(): void {
    const r = this.session.lastResult!;
    this.lastHash = this.session.sim!.stateHash();
    if (r.status === 'win') {
      this.winDelay = 1.15;
      this.toast('대성공!', '', 1100);
    } else {
      this.fails++;
      const msg = r.reason === 'forbidden' ? '앗, 건드리면 안 되는 걸 건드렸어요!' : r.reason === 'timeout' ? '시간이 다 됐어요!' : '아깝다! 표시된 곳을 확인해 보세요';
      this.toast(msg, '', 2600);
      this.failT = 0;
      // 마지막 궤적(4.7): 공이 지나간 길을 점선으로 남긴다
      const rp = this.session.sim!.replay;
      this.failPath = [];
      if (rp) for (let i = 0; i < rp.frames.length; i += 4) {
        const f = rp.frames[i]!;
        if (!Number.isNaN(f[0]!)) this.failPath.push(toPx(f[0]!, f[1]!));
      }
      this.ui.fire!.classList.add('glow');
    }
  }

  private drawFailMarker(dt: number): void {
    const r = this.session.lastResult;
    const g = this.failMarker;
    g.clear();
    if (!r || r.status !== 'fail' || !r.focus || this.session.phase !== 'done') return;
    this.failT += dt;
    const [x, y] = toPx(r.focus.x, r.focus.y);
    const p = (this.failT * 1.4) % 1;
    const col = r.focus.kind === 'forbidden' ? 0xff4d6d : 0xffb000;
    const shown = Math.min(this.failPath.length, Math.floor(this.failT * 90));
    for (let i = 0; i < shown; i++) {
      const [px, py] = this.failPath[i]!;
      g.circle(px, py, 2.6).fill({ color: 0x7a5a90, alpha: 0.35 });
    }
    g.circle(x, y, 22 + p * 26).stroke({ width: 4, color: col, alpha: 1 - p });
    g.circle(x, y, 20).stroke({ width: 3, color: col, alpha: 0.9 });
    g.circle(x, y, 20).fill({ color: col, alpha: 0.12 });
  }

  // ---------------- 결과 화면 + 리플레이 ----------------
  private showResult(): void {
    const sim = this.session.sim!;
    const r = this.session.lastResult!;
    if (r.status !== 'win') return; // 실패 결과는 결과 화면·진행·재화를 바꾸지 않는다
    this.replay = new ReplayPlayer(sim.replay!);
    this.fx.clear();
    this.view.resetDynamic(this.level);
    this.director.reset();
    this.ctx.onWin(this, r.stars, this.session.edit.placements.length);
    this.camTarget = { x: (390 - PLAY_W * 0.7) / 2 - PLAY_X * 0.7, y: 56 - PLAY_Y * 0.7, s: 0.7 };
    this.ui.sel!.classList.add('hidden');
    this.dom.querySelector('.bottom')!.classList.add('hidden');
    this.dom.querySelector('.hud-top')!.classList.add('hidden');
    this.resultT = 0;
    const res = el('div', 'result', '', { 'data-id': 'result' });
    res.appendChild(el('h2', '', r.stars === 3 ? '완벽해요!' : '대성공!'));
    const stars = el('div', 'stars');
    for (let i = 0; i < 3; i++) {
      const im = icon(i < r.stars ? 'ui_star_default' : 'ui_star_empty');
      stars.appendChild(im);
      window.setTimeout(() => {
        im.classList.add('on');
        if (i < r.stars) {
          sfx.star(i);
          buzz(15);
        }
      }, 450 + i * 260);
    }
    res.appendChild(stars);
    const notes = el('div', 'star-notes');
    const ringNote = this.level.bonusGoal ? (r.ringPassed ? '황금 링 통과' : '황금 링 놓침') : '추가 목표 완료';
    const objNote = `물건 ${this.level.starMaxObjects}개 이하`;
    notes.append(el('span', 'ok', '모든 표적'), el('span', r.stars >= 2 && (!this.level.bonusGoal || r.ringPassed) ? 'ok' : '', ringNote), el('span', this.session.edit.placements.length <= this.level.starMaxObjects ? 'ok' : '', objNote));
    res.appendChild(notes);
    const gained = this.ctx.lastReward;
    if (gained > 0) {
      const rw = el('div', 'reward', '');
      rw.appendChild(icon('ui_token_screw'));
      rw.appendChild(el('span', '', `+${gained}`));
      res.appendChild(rw);
    }
    const row = el('div', 'row');
    const again = el('button', 'btn secondary', '다시', { 'data-id': 'again' });
    again.onclick = () => this.backToEdit();
    const share = el('button', 'btn share', '공유', { 'data-id': 'share' });
    share.onclick = () => this.ctx.shareReplay(this);
    const next = el('button', 'btn primary', this.index + 1 < this.ctx.levels.length ? '다음 레벨' : '처음으로', { 'data-id': 'next' });
    next.onclick = () => this.ctx.next(this);
    row.append(again, share, next);
    res.appendChild(row);
    const tag = el('div', 'replay-tag', '<i></i>REPLAY');
    this.dom.append(res, tag);
    this.ui.result = res;
    this.ui.tag = tag;
  }

  backToEdit(): void {
    sfx.click();
    this.replay = null;
    this.ui.result?.remove();
    this.ui.tag?.remove();
    this.dom.querySelector('.bottom')!.classList.remove('hidden');
    this.dom.querySelector('.hud-top')!.classList.remove('hidden');
    this.camTarget = { x: 0, y: 0, s: 1 };
    this.session.retry();
    this.enterEdit();
  }

  get inReplay(): boolean {
    return this.replay !== null;
  }
  replayProgress(): number {
    return this.replay ? this.replay.t / this.replay.length : 0;
  }

  // ---------------- 매 프레임 ----------------
  tick(dt: number): void {
    const s = this.session;
    this.fx.update(dt);
    this.view.animate(dt);
    if (s.phase === 'running') {
      const before = s.phase;
      s.frame(dt * this.fx.timeScale());
      this.syncSim();
      if (before === 'running' && (s.phase as string) === 'done') this.onFinished();
    } else if (s.phase === 'done' && !this.replay) {
      this.drawFailMarker(dt);
      if (this.winDelay > 0) {
        this.winDelay -= dt;
        if (this.winDelay <= 0) this.showResult();
      }
    }
    if (this.replay) {
      this.resultT += dt;
      const { events, restarted } = this.replay.update(dt * this.fx.timeScale());
      if (restarted) {
        this.view.resetDynamic(this.level);
        this.director.reset();
        this.fx.clear();
      }
      for (const e of events) this.director.react(e as SimEvent);
      this.view.setBodies(this.replay.bodies());
    }
    if (s.phase === 'edit' && this.dirty) this.redrawEdit();
    // 카메라: 흔들림·줌 펀치 + 결과 화면 축소 이동
    const k = Math.min(1, dt * 7);
    this.camCur.x += (this.camTarget.x - this.camCur.x) * k;
    this.camCur.y += (this.camTarget.y - this.camCur.y) * k;
    this.camCur.s += (this.camTarget.s - this.camCur.s) * k;
    const c = this.fx.camera();
    this.camZoom = c.zoom;
    const cx = PLAY_X + PLAY_W / 2;
    const cy = PLAY_Y + PLAY_H / 2;
    this.cam.pivot.set(cx, cy);
    const sc = this.camCur.s * this.camZoom;
    this.cam.scale.set(sc);
    this.cam.rotation = c.rot;
    this.cam.position.set(cx * this.camCur.s + this.camCur.x + c.dx, cy * this.camCur.s + this.camCur.y + c.dy);
  }

  private redrawEdit(): void {
    this.dirty = false;
    const s = this.session;
    const problems = new Set(s.problems().map((p) => p.uid));
    const lifted = this.mode.k === 'drag' ? this.mode.uid : null;
    if (this.mode.k === 'drag') {
      const p = s.find(this.mode.uid);
      if (p) {
        const snapped = { ...p, pos: snapToArea(this.level, p.type, p.pos) };
        if (placementProblem(this.level, s.edit, snapped) || this.overDrawer) problems.add(p.uid);
        else problems.delete(p.uid);
      }
    }
    this.view.syncPlacements(s.edit, problems, this.selected, lifted);
    this.view.setCannon(s.edit.cannonAngle, true);
    const sel = this.selected !== null ? s.find(this.selected) ?? null : null;
    this.view.setRotHandle(this.mode.k === 'drag' ? null : sel);
    this.view.drawPreview(previewPath(this.level, s.edit), this.mode.k === 'aim' ? 1 : 0.8);
    this.placeSelTools(sel);
  }

  private placeSelTools(sel: Placement | null): void {
    const box = this.ui.sel!;
    if (!sel || this.mode.k === 'drag' || this.session.phase !== 'edit') {
      box.classList.add('hidden');
      return;
    }
    const poly = placementPoly(sel);
    const top = Math.min(...poly.map((p) => toPx(p[0], p[1])[1]));
    const [x] = toPx(sel.pos[0], sel.pos[1]);
    box.classList.remove('hidden');
    const ly = Math.max(70 + 44, top + PLAY_Y - 26);
    box.style.left = `${Math.max(70, Math.min(320, x + PLAY_X))}px`;
    box.style.top = `${ly}px`;
  }

  private select(uid: number | null): void {
    this.selected = uid;
    this.dirty = true;
  }

  private rotateSelected(d: number): void {
    if (this.selected === null) return;
    if (this.session.rotate(this.selected, d)) {
      sfx.tick();
      this.changed();
    }
  }

  // ---------------- 입력 ----------------
  private overDrawer = false;

  /** 화면 좌표 → 논리 좌표(390×844) */
  private logical(e: PointerEvent): [number, number] {
    const r = this.ctx.appEl.getBoundingClientRect();
    const sc = r.width / 390;
    return [(e.clientX - r.left) / sc, (e.clientY - r.top) / sc];
  }

  private bindInput(): void {
    const cv = this.ctx.canvas;
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    cv.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.unbind = () => {
      cv.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }
  private unbind: () => void = () => {};
  private activePointer: number | null = null;

  private onCardDown(e: PointerEvent, type: PlaceableType): void {
    unlock();
    if (this.session.phase !== 'edit' || this.activePointer !== null) return;
    e.preventDefault();
    const [lx, ly] = this.logical(e);
    const touch = e.pointerType === 'touch';
    const m = toM(lx - PLAY_X, ly - PLAY_Y - (touch ? 46 : 0));
    const p = this.session.add(type, [m[0], Math.max(0.3, m[1])], 0);
    if (!p) {
      sfx.drop(false);
      return;
    }
    this.activePointer = e.pointerId;
    sfx.pick();
    buzz(8);
    this.hideTutorial();
    this.session.moveRaw(p.uid, m);
    this.mode = { k: 'drag', uid: p.uid, startPos: m, lastValid: null, moved: true, sx: lx, sy: ly, touch, fresh: true };
    this.select(p.uid);
    this.renderDrawer();
  }

  private hitPlacement(wx: number, wy: number): Placement | null {
    const list = [...this.session.edit.placements].reverse();
    for (const p of list) {
      const [cx, cy] = toPx(p.pos[0], p.pos[1]);
      const a = p.rot * DEG;
      const dx = wx - cx;
      const dy = wy - cy;
      // 회전 좌표계로 옮겨 최소 44pt 터치 판정
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const [w, h] = p.type === 'ramp' ? [1.2 * PX_PER_M, 0.16 * PX_PER_M] : [0.6 * PX_PER_M, 0.26 * PX_PER_M];
      if (Math.abs(lx) <= Math.max(44, w) / 2 + 4 && Math.abs(ly) <= Math.max(44, h) / 2) return p;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    unlock();
    if (this.session.phase !== 'edit' || this.replay || this.activePointer !== null) return; // 발사 중 화면 탭은 효과 없음
    const [lx, ly] = this.logical(e);
    const wx = lx - PLAY_X;
    const wy = ly - PLAY_Y;
    this.activePointer = e.pointerId;
    const touch = e.pointerType === 'touch';
    const sel = this.selected !== null ? this.session.find(this.selected) : undefined;
    if (sel) {
      const [hx, hy] = this.view.rotHandlePos(sel);
      if (Math.hypot(wx - hx, wy - hy) < 26) {
        this.session.beginGesture();
        this.mode = { k: 'rotate', uid: sel.uid, start: sel.rot };
        sfx.pick();
        return;
      }
    }
    const hit = this.hitPlacement(wx, wy);
    if (hit) {
      this.session.beginGesture();
      this.mode = { k: 'drag', uid: hit.uid, startPos: [...hit.pos] as Vec, lastValid: [...hit.pos] as Vec, moved: false, sx: lx, sy: ly, touch, fresh: false };
      this.select(hit.uid);
      sfx.pick();
      buzz(6);
      window.clearTimeout(this.longTimer);
      this.longTimer = window.setTimeout(() => {
        if (this.mode.k === 'drag' && !this.mode.moved) this.showTip(hit.type, lx, ly);
      }, 450);
      return;
    }
    const [hx, hy] = this.view.cannonHandlePos();
    const [cx, cy] = this.view.cannonPos();
    if (Math.hypot(wx - hx, wy - hy) < 34 || Math.hypot(wx - cx, wy - cy) < 40) {
      this.session.beginGesture();
      this.mode = { k: 'aim', start: this.session.edit.cannonAngle };
      this.select(null);
      this.hideTutorial();
      window.clearTimeout(this.longTimer);
      this.longTimer = window.setTimeout(() => {
        if (this.mode.k === 'aim' && this.session.edit.cannonAngle === this.mode.start) this.showTip('cannon', lx, ly);
      }, 450);
      this.aimTo(wx, wy, Math.hypot(wx - hx, wy - hy) < 34);
      return;
    }
    this.select(null);
    this.activePointer = null;
  }

  private aimTo(wx: number, wy: number, apply: boolean): void {
    const [cx, cy] = this.view.cannonPos();
    if (!apply && Math.hypot(wx - cx, wy - cy) < 40) return;
    const a = Math.atan2(cy - wy, wx - cx) / DEG;
    const before = this.session.edit.cannonAngle;
    this.session.setCannonAngle(a, false);
    if (this.session.edit.cannonAngle !== before) {
      if (Math.abs(this.session.edit.cannonAngle) % 5 === 0) sfx.tick();
      this.dirty = true;
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.activePointer) return;
    const [lx, ly] = this.logical(e);
    const wx = lx - PLAY_X;
    const wy = ly - PLAY_Y;
    const m = this.mode;
    if (m.k === 'aim') {
      this.hideTip();
      this.aimTo(wx, wy, true);
    } else if (m.k === 'drag') {
      if (!m.moved && Math.hypot(lx - m.sx, ly - m.sy) > 6) {
        m.moved = true;
        this.hideTip();
      }
      if (!m.moved) return;
      // 손가락보다 위로 띄워 가리지 않게(3장)
      const lift = m.touch ? 46 : 0;
      this.overDrawer = ly > BOTTOM_Y;
      m.lastValid = this.session.dragTo(m.uid, toM(wx, wy - lift), m.lastValid, !this.overDrawer);
      this.dirty = true;
    } else if (m.k === 'rotate') {
      const p = this.session.find(m.uid);
      if (!p) return;
      const [cx, cy] = toPx(p.pos[0], p.pos[1]);
      const a = Math.atan2(cy - wy, wx - cx) / DEG;
      const before = p.rot;
      this.session.setRotation(m.uid, a);
      if (p.rot !== before) {
        sfx.tick();
        buzz(4);
        this.dirty = true;
      }
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    window.clearTimeout(this.longTimer);
    this.hideTip();
    const m = this.mode;
    this.mode = { k: 'none' };
    if (m.k === 'aim') {
      this.session.endGesture(this.session.edit.cannonAngle !== m.start);
      if (this.session.edit.cannonAngle !== m.start) this.changed();
    } else if (m.k === 'rotate') {
      const p = this.session.find(m.uid);
      const rotated = !!p && p.rot !== m.start;
      this.session.endGesture(rotated);
      if (rotated) this.changed();
      else this.dirty = true;
    } else if (m.k === 'drag') {
      if (this.overDrawer) {
        // 서랍으로 되돌리기
        this.session.removeRaw(m.uid);
        if (m.fresh) this.session.endGesture(false);
        this.select(null);
        sfx.drop(true);
        this.overDrawer = false;
        this.changed();
        return;
      }
      if (!m.moved) {
        this.session.endGesture(false);
        this.dirty = true;
        return;
      }
      const res = m.lastValid ? this.session.drop(m.uid, m.lastValid) : this.dropFresh(m.uid);
      if (!res.ok && !m.lastValid) {
        this.session.removeRaw(m.uid);
        this.session.endGesture(false);
        this.select(null);
        this.toast('여기엔 놓을 수 없어요', 'warn', 1400);
      } else {
        if (!res.ok) this.toast('여기엔 놓을 수 없어요', 'warn', 1400);
        // 새로 꺼낸 물건은 add()가 만든 되돌리기 지점을 그대로 쓴다
        if (!m.fresh) this.session.endGesture(res.pos[0] !== m.startPos[0] || res.pos[1] !== m.startPos[1]);
      }
      sfx.drop(res.ok);
      buzz(res.ok ? 10 : 25);
      this.view.popPlacement(m.uid);
      this.changed();
    }
  }

  private dropFresh(uid: number): { ok: boolean; pos: Vec } {
    const p = this.session.find(uid)!;
    p.pos = snapToArea(this.level, p.type, p.pos);
    return { ok: !placementProblem(this.level, this.session.edit, p), pos: p.pos };
  }

  private showTip(kind: string, lx: number, ly: number): void {
    this.hideTip();
    const t = el('div', 'tip', INFO[kind] ?? '');
    t.style.left = `${Math.max(120, Math.min(270, lx))}px`;
    t.style.top = `${ly}px`;
    this.dom.appendChild(t);
    this.ui.tip = t;
    buzz(12);
  }
  private hideTip(): void {
    this.ui.tip?.remove();
    delete this.ui.tip;
  }

  // ---------------- 튜토리얼(8.1: 1레벨은 손가락으로 대포 끄는 동작만) ----------------
  private fingerAnim = 0;
  private tutorial(): void {
    this.tutorialShown = true;
    const tut = this.level.tutorial;
    if (!tut || (this.save.levelProgress[this.level.levelId]?.stars ?? 0) > 0) return;
    if (tut === 'drag-cannon' || tut === 'drag-object') {
      const f = el('div', 'finger', '👆');
      this.dom.appendChild(f);
      this.ui.finger = f;
      const sol = this.level.solutions[0];
      const t0 = performance.now();
      const anim = () => {
        if (!this.ui.finger || this.destroyed) return;
        const k = ((performance.now() - t0) / 1600) % 1;
        const e = k < 0.15 ? 0 : k > 0.75 ? 1 : (k - 0.15) / 0.6;
        const ease = e * e * (3 - 2 * e);
        let x: number;
        let y: number;
        if (tut === 'drag-cannon') {
          const [cx, cy] = this.view.cannonPos();
          const a0 = this.session.edit.cannonAngle * DEG;
          const a1 = (sol?.cannonAngle ?? 30) * DEG;
          const a = a0 + (a1 - a0) * ease;
          const r = 76;
          x = cx + Math.cos(a) * r + PLAY_X;
          y = cy - Math.sin(a) * r + PLAY_Y;
        } else {
          const card = this.ui.drawer!.querySelector('.card') as HTMLElement | null;
          const appR = this.ctx.appEl.getBoundingClientRect();
          const sc = appR.width / 390;
          const cr = card?.getBoundingClientRect();
          const sx = cr ? (cr.left + cr.width / 2 - appR.left) / sc : 50;
          const sy = cr ? (cr.top + cr.height / 2 - appR.top) / sc : 760;
          const tgt = sol?.objects[0]?.pos ?? [2.4, 3];
          const [tx, ty] = toPx(tgt[0], tgt[1]);
          x = sx + (tx + PLAY_X - sx) * ease;
          y = sy + (ty + PLAY_Y - sy) * ease;
        }
        f.style.left = `${x}px`;
        f.style.top = `${y}px`;
        f.style.opacity = k > 0.88 ? String((1 - k) / 0.12) : '1';
        this.fingerAnim = requestAnimationFrame(anim);
      };
      anim();
    } else {
      const msg: Record<string, string> = {
        'rotate-object': '물건을 누르고 파란 손잡이를 돌려 보세요',
        bumper: '분홍 쿠션은 화살표 방향으로 튕겨요!',
        ring: '황금 링을 통과하면 별이 하나 더!',
      };
      this.toast(msg[tut] ?? '', '', 3200);
    }
  }
  private hideTutorial(): void {
    cancelAnimationFrame(this.fingerAnim);
    this.ui.finger?.remove();
    delete this.ui.finger;
  }

  // ---------------- 힌트(4.7) ----------------
  showHint(stage: number): void {
    const sol = this.level.solutions[0];
    const g = this.hintGhost;
    g.clear();
    if (!sol) return;
    if (stage >= 1) {
      this.view.showAreas(this.level, this.level.placeable.length > 0, sol.objects[0]?.type);
      for (const card of this.ui.drawer!.querySelectorAll('.card')) card.classList.add('hint');
      for (const goal of this.level.goals) {
        const [x, y] = toPx(goal.pos[0], goal.pos[1]);
        g.circle(x, y, 40).stroke({ width: 3, color: 0xffd34d, alpha: 0.9 });
      }
    }
    if (stage >= 2 && sol.objects[0]) {
      const [x, y] = toPx(sol.objects[0].pos[0], sol.objects[0].pos[1]);
      g.circle(x, y, 46).fill({ color: 0x6b8cff, alpha: 0.16 }).stroke({ width: 3, color: 0x6b8cff, alpha: 0.8 });
    }
    if (stage >= 3) {
      for (const o of sol.objects) {
        const poly = placementPoly(o).map((p) => toPx(p[0], p[1]));
        g.poly(poly.flat()).fill({ color: 0xffffff, alpha: 0.35 }).stroke({ width: 2, color: 0x6b8cff, alpha: 0.9 });
      }
      const [cx, cy] = this.view.cannonPos();
      const a = sol.cannonAngle * DEG;
      g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * 70, cy - Math.sin(a) * 70).stroke({ width: 4, color: 0x6b8cff, alpha: 0.7, cap: 'round' });
    }
  }

  applySolution(): void {
    const sol = this.level.solutions[0];
    if (!sol || this.session.phase !== 'edit') return;
    this.session.apply(solutionEdit(sol));
    this.hintGhost.clear();
    this.select(null);
    this.changed();
  }

  /** 테스트용: 현재 편집 상태 */
  editState(): EditState {
    return this.session.edit;
  }

  destroy(): void {
    this.destroyed = true;
    this.hideTutorial();
    this.unbind();
    window.clearTimeout(this.toastTimer);
    this.dom.remove();
    this.cam.destroy({ children: true });
  }
}
