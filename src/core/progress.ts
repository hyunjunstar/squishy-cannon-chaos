// 클리어 보상·진행 계산(4.6, 4.8). 순수 함수라 테스트한다.
export interface LevelRecord {
  stars: number;
  bestObjects: number;
  version: number;
}

/** 나사 토큰: 첫 클리어 20개 + 첫 별을 넘는 새 별 1개당 5개. 반복 클리어·이미 얻은 별은 재지급 없음 */
export function clearReward(prev: LevelRecord | undefined, stars: number): number {
  if (stars <= 0) return 0;
  const prevStars = prev?.stars ?? 0;
  let r = prev ? 0 : 20;
  if (stars > prevStars) r += (stars - Math.max(1, prevStars)) * 5;
  return r;
}

export function mergeRecord(prev: LevelRecord | undefined, stars: number, objects: number, version: number): LevelRecord {
  return {
    stars: Math.max(prev?.stars ?? 0, stars),
    bestObjects: prev ? Math.min(prev.bestObjects, objects) : objects,
    version,
  };
}
