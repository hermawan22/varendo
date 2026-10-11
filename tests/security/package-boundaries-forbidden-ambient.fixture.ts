// @ts-nocheck
export function ambientEffects() {
  return [Date.now(), Math.random(), new Date(), fetch('/network')];
}
