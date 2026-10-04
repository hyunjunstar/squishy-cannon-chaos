import { readFileSync } from 'node:fs';
import { Simulation } from '../src/core/sim';
import type { LevelData } from '../src/core/types';
const level = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as LevelData;
const wins: number[] = [];
for (let a = level.cannon.angleRange[0]; a <= level.cannon.angleRange[1]; a++) {
  const r = new Simulation(level, { cannonAngle: a, placements: [] }).run();
  if (r.status === 'win') wins.push(a);
  else if (process.argv[3]) console.log(a, r.reason, r.step, r.goalsDone);
}
console.log('wins', wins.join(','));
