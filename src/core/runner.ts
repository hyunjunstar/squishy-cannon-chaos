// 화면 프레임과 분리된 고정 단계 구동기(6.4). 2배속은 프레임당 고정 단계를 두 번 실행한다.
import { STEP_DT } from './constants';

export class FixedStepper {
  private acc = 0;
  /** 한 화면 프레임(dtSec) 동안 실행할 고정 단계 수. speed=2면 기본 단계 수의 2배 */
  frame(dtSec: number, speed: 1 | 2): number {
    this.acc += Math.min(dtSec, 0.1); // 백그라운드 복귀 등 큰 간격은 잘라 폭주 방지
    let base = 0;
    while (this.acc >= STEP_DT - 1e-9) {
      this.acc -= STEP_DT;
      base++;
    }
    return base * speed;
  }
  reset(): void {
    this.acc = 0;
  }
}
