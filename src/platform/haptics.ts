// 햅틱 어댑터: 웹은 navigator.vibrate, 앱에서는 Capacitor Haptics로 교체.
let enabled = true;
export function setHaptics(on: boolean): void {
  enabled = on;
}
export function buzz(ms: number): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 지원 안 함 */
  }
}
