// 한 레벨 플레이 세션: 편집 → 발사 → 관찰 → 재배치. 되돌리기·스냅샷·2배속 유지(3장, 4.1~4.5).
import { cloneEdit, clampCannon, editProblems, newEditState, placementProblem, remaining, snapRot, snapToArea } from './level';
import type { PlacementProblem } from './level';
import { FixedStepper } from './runner';
import { Simulation } from './sim';
import type { EditState, LevelData, PlaceableType, Placement, SimResult, Vec } from './types';

export type Phase = 'edit' | 'running' | 'done';

export class Session {
  readonly level: LevelData;
  edit: EditState;
  phase: Phase = 'edit';
  sim: Simulation | null = null;
  /** 발사 시점 스냅샷(4.1) */
  snapshot: EditState | null = null;
  speed: 1 | 2 = 1;
  attempts = 0;
  lastResult: SimResult | null = null;
  private undoStack: EditState[] = [];
  private nextUid = 1;
  private readonly stepper = new FixedStepper();

  constructor(level: LevelData, initial?: EditState) {
    this.level = level;
    this.edit = initial ? cloneEdit(initial) : newEditState(level);
    this.nextUid = Math.max(0, ...this.edit.placements.map((p) => p.uid)) + 1;
  }

  // ---- 편집(물리 정지 상태) ----
  private commit(): void {
    this.undoStack.push(cloneEdit(this.edit));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  canEdit(): boolean {
    return this.phase === 'edit';
  }

  setCannonAngle(deg: number, record = true): boolean {
    if (!this.canEdit()) return false;
    const a = clampCannon(this.level, deg);
    if (a === this.edit.cannonAngle) return false;
    if (record) this.commit();
    this.edit.cannonAngle = a;
    return true;
  }

  /** 드래그 시작 시 한 번 호출해 되돌리기 지점을 만든다 */
  beginGesture(): void {
    if (this.canEdit()) this.commit();
  }

  /** 드래그 중 취소(아무것도 안 바뀐 제스처)면 되돌리기 지점 제거 */
  endGesture(changed: boolean): void {
    if (!changed) this.undoStack.pop();
  }

  add(type: PlaceableType, pos: Vec, rot = 0): Placement | null {
    if (!this.canEdit() || remaining(this.level, this.edit, type) <= 0) return null;
    this.commit();
    const p: Placement = { uid: this.nextUid++, type, pos: snapToArea(this.level, type, pos), rot: snapRot(rot) };
    this.edit.placements.push(p);
    return p;
  }

  /** 드래그 중 위치(스냅 전) — 기록 없이 이동만 */
  moveRaw(uid: number, pos: Vec): void {
    const p = this.find(uid);
    if (p && this.canEdit()) p.pos = [pos[0], pos[1]];
  }

  /** 드래그 중 이동. 스냅한 자리가 놓을 수 있으면 그 자리를 새 '마지막 유효 위치'로 돌려준다(3장 배치 규칙) */
  dragTo(uid: number, pos: Vec, lastValid: Vec | null, track = true): Vec | null {
    const p = this.find(uid);
    if (!p || !this.canEdit()) return lastValid;
    p.pos = [pos[0], pos[1]];
    if (!track) return lastValid;
    const snapped = snapToArea(this.level, p.type, pos);
    const ok = !placementProblem(this.level, this.edit, { ...p, pos: snapped });
    return ok ? snapped : lastValid;
  }

  /** 놓을 때: 스냅 후 불가능 위치면 마지막 유효 위치로 복귀(3장 배치 규칙) */
  drop(uid: number, lastValid: Vec): { ok: boolean; pos: Vec } {
    const p = this.find(uid);
    if (!p) return { ok: false, pos: lastValid };
    p.pos = snapToArea(this.level, p.type, p.pos);
    if (placementProblem(this.level, this.edit, p)) {
      p.pos = [lastValid[0], lastValid[1]];
      return { ok: false, pos: p.pos };
    }
    return { ok: true, pos: p.pos };
  }

  rotate(uid: number, deltaDeg: number, record = true): boolean {
    const p = this.find(uid);
    if (!p || !this.canEdit()) return false;
    if (record) this.commit();
    p.rot = snapRot(p.rot + deltaDeg);
    return true;
  }

  setRotation(uid: number, deg: number): void {
    const p = this.find(uid);
    if (p && this.canEdit()) p.rot = snapRot(deg);
  }

  remove(uid: number): boolean {
    if (!this.canEdit() || !this.find(uid)) return false;
    this.commit();
    this.edit.placements = this.edit.placements.filter((p) => p.uid !== uid);
    return true;
  }

  /** 제스처 안에서 제거(되돌리기 지점은 beginGesture가 이미 만듦) */
  removeRaw(uid: number): void {
    if (this.canEdit()) this.edit.placements = this.edit.placements.filter((p) => p.uid !== uid);
  }

  /** 힌트 3단계: 검증된 배치 적용(되돌리기 가능, 4.7) */
  apply(edit: EditState): void {
    if (!this.canEdit()) return;
    this.commit();
    this.edit = cloneEdit(edit);
    this.nextUid = Math.max(this.nextUid, ...this.edit.placements.map((p) => p.uid + 1));
  }

  undo(): boolean {
    if (!this.canEdit()) return false;
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.edit = prev;
    return true;
  }

  canUndo(): boolean {
    return this.canEdit() && this.undoStack.length > 0;
  }

  /** 초기 배치 복원(전체 초기화 — 별도 버튼, 4.5) */
  resetAll(): void {
    if (!this.canEdit()) return;
    this.commit();
    this.edit = newEditState(this.level);
  }

  find(uid: number): Placement | undefined {
    return this.edit.placements.find((p) => p.uid === uid);
  }

  problems(): PlacementProblem[] {
    return editProblems(this.level, this.edit);
  }

  // ---- 발사 ----
  fire(record = true): { ok: true } | { ok: false; problems: PlacementProblem[] } {
    if (this.phase !== 'edit') return { ok: false, problems: [] };
    const problems = this.problems();
    if (problems.length) return { ok: false, problems }; // 겹침·벽 관통 상태면 발사 차단(4.1)
    this.snapshot = cloneEdit(this.edit);
    this.sim = new Simulation(this.level, cloneEdit(this.edit), { record });
    this.phase = 'running';
    this.attempts++;
    this.stepper.reset();
    return { ok: true };
  }

  /** 화면 프레임 하나 진행. 반환: 실행한 고정 단계 수 */
  frame(dtSec: number): number {
    if (this.phase !== 'running' || !this.sim) return 0;
    const n = this.stepper.frame(dtSec, this.speed);
    for (let i = 0; i < n && !this.sim.finished; i++) this.sim.stepOnce();
    if (this.sim.finished) {
      this.phase = 'done';
      this.lastResult = this.sim.result;
    }
    return n;
  }

  toggleSpeed(): 1 | 2 {
    this.speed = this.speed === 1 ? 2 : 1; // 다음 발사에도 유지(3장)
    return this.speed;
  }

  /** 재배치: 언제든 즉시 중단 후 발사 직전 배치로 복귀. 실패로 기록하지 않음(4.2, 4.5) */
  retry(): void {
    if (this.snapshot) this.edit = cloneEdit(this.snapshot);
    this.sim = null;
    this.phase = 'edit';
    this.stepper.reset();
  }
}
