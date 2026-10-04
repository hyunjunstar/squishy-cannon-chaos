// 세이브 어댑터(5.5 일부). 웹은 localStorage, 앱은 Capacitor Preferences로 교체 예정.
import type { EditState } from '../core/types';

export interface LevelProgress {
  stars: number;
  bestObjects: number;
  version: number;
}
export interface SaveData {
  levelProgress: Record<string, LevelProgress>;
  editSnapshot: { levelId: string; edit: EditState } | null;
  hintTokens: number;
  screws: number;
  hintUnlocked: Record<string, number>;
  settings: { speed: 1 | 2; sound: boolean; haptics: boolean };
}

const KEY = 'squishy-cannon-save-v1';
const fresh = (): SaveData => ({
  levelProgress: {},
  editSnapshot: null,
  hintTokens: 3,
  screws: 0,
  hintUnlocked: {},
  settings: { speed: 1, sound: true, haptics: true },
});

function sanitize(raw: unknown): SaveData {
  const d = fresh();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  if (r.levelProgress && typeof r.levelProgress === 'object') {
    for (const [k, v] of Object.entries(r.levelProgress)) {
      if (v && typeof v.stars === 'number') d.levelProgress[k] = { stars: Math.max(0, Math.min(3, v.stars | 0)), bestObjects: v.bestObjects | 0, version: v.version | 0 };
    }
  }
  if (typeof r.hintTokens === 'number' && r.hintTokens >= 0) d.hintTokens = r.hintTokens | 0;
  if (typeof r.screws === 'number' && r.screws >= 0) d.screws = r.screws | 0;
  if (r.hintUnlocked && typeof r.hintUnlocked === 'object') d.hintUnlocked = { ...r.hintUnlocked };
  if (r.settings) d.settings = { ...d.settings, ...r.settings, speed: r.settings.speed === 2 ? 2 : 1 };
  if (r.editSnapshot && typeof r.editSnapshot.levelId === 'string' && r.editSnapshot.edit) d.editSnapshot = r.editSnapshot;
  return d;
}

export function loadSave(): SaveData {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return fresh();
  }
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* 저장 실패는 게임 진행을 막지 않는다 */
  }
}
