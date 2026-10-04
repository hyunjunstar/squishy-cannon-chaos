import { readFileSync } from 'node:fs';
import { Simulation } from '../src/core/sim';
import type { LevelData } from '../src/core/types';
const level = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as LevelData;
const edit = process.argv[4] ? JSON.parse(process.argv[4]) : { cannonAngle: Number(process.argv[3]), placements: [] };
const sim = new Simulation(level, edit);
while (!sim.finished) {
  sim.stepOnce();
  if (sim.step % 15 === 0) console.log(sim.step, sim.bodies().map((b) => `${b.id}(${b.x.toFixed(2)},${b.y.toFixed(2)},${(b.angle*57.3).toFixed(0)})`).join(' '));
}
console.log(sim.events.filter((e) => e.t !== 'hit' || e.impulse > 0.5).map((e) => JSON.stringify(e)).join('\n'));
console.log(sim.result);
