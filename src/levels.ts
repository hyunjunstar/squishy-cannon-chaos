// 레벨 JSON 묶음(브라우저). Node 도구는 levels/ 폴더를 직접 읽는다.
import type { LevelData } from './core/types';

const mods = import.meta.glob('../levels/level*.json', { eager: true, import: 'default' }) as Record<string, LevelData>;
export const LEVELS: LevelData[] = Object.keys(mods)
  .sort()
  .map((k) => mods[k]!);
