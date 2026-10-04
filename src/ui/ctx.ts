import type { Container } from 'pixi.js';
import type { LevelData } from '../core/types';
import type { Art, FxTextures } from '../render/art';
import type { PlayScreen } from './play';

export interface GameCtx {
  levels: LevelData[];
  art: Art;
  fxTex: FxTextures;
  stage: Container;
  overlay: HTMLElement;
  canvas: HTMLCanvasElement;
  appEl: HTMLElement;
  effects: boolean;
  lastReward: number;
  pauseMenu(p: PlayScreen): void;
  hintMenu(p: PlayScreen): void;
  onWin(p: PlayScreen, stars: number, objects: number): void;
  next(p: PlayScreen): void;
  shareReplay(p: PlayScreen): void;
}
