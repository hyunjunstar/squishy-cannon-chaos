// 앱 진입점: PixiJS 초기화, 화면 전환(홈 ↔ 플레이), 저장, 테스트 훅.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import { Application, Container, Sprite, Graphics } from 'pixi.js';
import { solutionEdit } from './core/level';
import { clearReward, mergeRecord } from './core/progress';
import { Simulation } from './core/sim';
import { LEVELS } from './levels';
import { setSound, suspendAudio, unlock, sfx } from './platform/audio';
import { setHaptics } from './platform/haptics';
import { loadSave, writeSave } from './platform/storage';
import type { SaveData } from './platform/storage';
import { loadArt, makeFxTextures } from './render/art';
import type { Art, FxTextures } from './render/art';
import type { GameCtx } from './ui/ctx';
import { el, icon } from './ui/dom';
import { PlayScreen } from './ui/play';

const W = 390;
const H = 844;
const params = new URLSearchParams(location.search);

class Game implements GameCtx {
  levels = LEVELS;
  art!: Art;
  fxTex!: FxTextures;
  stage = new Container();
  overlay!: HTMLElement;
  canvas!: HTMLCanvasElement;
  appEl = document.getElementById('app')!;
  effects = params.get('fx') !== '0';
  lastReward = 0;
  save: SaveData = loadSave();
  app = new Application();
  play: PlayScreen | null = null;
  home: HTMLElement | null = null;
  perf = { frames: [] as number[], work: [] as number[], recording: false };
  private workStart = 0;

  async init(): Promise<void> {
    await this.app.init({
      width: W,
      height: H,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: false,
      antialias: true,
      backgroundAlpha: 0,
      preference: 'webgl',
    });
    this.canvas = this.app.canvas;
    this.appEl.appendChild(this.canvas);
    this.overlay = el('div', 'layer');
    this.appEl.appendChild(this.overlay);
    this.app.stage.addChild(this.stage);
    [this.art] = await Promise.all([loadArt(), document.fonts?.ready]);
    this.fxTex = makeFxTextures(this.app.renderer);
    if (this.art.bg) {
      const bg = new Sprite(this.art.bg);
      const s = Math.max(W / bg.texture.width, H / bg.texture.height);
      bg.scale.set(s);
      bg.position.set((W - bg.texture.width * s) / 2, (H - bg.texture.height * s) / 2);
      this.app.stage.addChildAt(bg, 0);
    } else {
      this.app.stage.addChildAt(new Graphics().rect(0, 0, W, H).fill(0xffe9f1), 0);
    }
    setSound(this.save.settings.sound);
    setHaptics(this.save.settings.haptics);
    this.fit();
    window.addEventListener('resize', () => this.fit());
    // 백그라운드 이동 시 일시정지, 복귀 시 이어서(6.8)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.app.ticker.stop();
        suspendAudio();
      } else {
        this.app.ticker.start();
        unlock();
      }
    });
    // 그래픽 컨텍스트 손실: 게임 상태는 유지, 복구 후 다시 그림(6.8)
    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    // 더블탭 확대·스크롤 튕김 방지(6.8)
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    window.addEventListener('pointerdown', () => unlock(), { once: true });

    this.app.ticker.add(() => {
      this.workStart = performance.now();
      const dt = Math.min(this.app.ticker.deltaMS / 1000, 0.1);
      this.play?.tick(dt);
    }, undefined, 50);
    this.app.ticker.add(() => {
      if (this.perf.recording) {
        this.perf.frames.push(this.app.ticker.deltaMS);
        this.perf.work.push(performance.now() - this.workStart);
      }
    }, undefined, -100);

    const lv = Number(params.get('level'));
    if (lv >= 1 && lv <= this.levels.length) this.start(lv - 1);
    else this.showHome();
  }

  fit(): void {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    this.appEl.style.transform = `scale(${s})`;
  }

  unlocked(i: number): boolean {
    if (i === 0) return true;
    return (this.save.levelProgress[this.levels[i - 1]!.levelId]?.stars ?? 0) > 0;
  }

  showHome(): void {
    this.play?.destroy();
    this.play = null;
    this.home?.remove();
    const h = el('div', 'home', '', { 'data-id': 'home' });
    const title = '말랑 대포 대소동';
    const logo = el('div', 'logo');
    const k = el('div', 'k');
    [...title].forEach((ch, i) => {
      const s = el('span', '', ch === ' ' ? '&nbsp;' : ch);
      s.style.animationDelay = `${i * 0.08}s`;
      k.appendChild(s);
      if (i === 4) k.appendChild(el('br'));
    });
    logo.append(k, el('div', 'en', 'SQUISHY CANNON CHAOS'));
    const ch = el('div', 'chapter');
    const total = this.levels.reduce((a, l) => a + (this.save.levelProgress[l.levelId]?.stars ?? 0), 0);
    const head = el('h3', '', `장난감 방`);
    const sc = el('span', '', '');
    sc.append(icon('ui_star_default'), document.createTextNode(`${total}/${this.levels.length * 3}`));
    head.appendChild(sc);
    ch.appendChild(head);
    const grid = el('div', 'grid');
    let nextIdx = -1;
    this.levels.forEach((l, i) => {
      const stars = this.save.levelProgress[l.levelId]?.stars ?? 0;
      const open = this.unlocked(i);
      if (open && stars === 0 && nextIdx < 0) nextIdx = i;
      const b = el('button', `btn lv${open ? '' : ' locked'}${nextIdx === i ? ' next' : ''}`, open ? String(i + 1) : '🔒', { 'data-level': String(i + 1) });
      if (open) {
        const st = el('div', 'st');
        for (let j = 0; j < 3; j++) st.appendChild(icon(j < stars ? 'ui_star_default' : 'ui_star_empty'));
        b.appendChild(st);
        b.onclick = () => {
          unlock();
          sfx.click();
          this.start(i);
        };
      }
      grid.appendChild(b);
    });
    ch.appendChild(grid);
    const playBtn = el('button', 'btn primary bigplay', '플레이', { 'data-id': 'play' });
    playBtn.onclick = () => {
      unlock();
      sfx.click();
      this.start(Math.max(0, nextIdx));
    };
    h.append(logo, ch, playBtn);
    this.overlay.appendChild(h);
    this.home = h;
  }

  start(i: number): void {
    this.home?.remove();
    this.home = null;
    this.play?.destroy();
    this.closeModal();
    this.play = new PlayScreen(this, i, this.save);
  }

  // ---- 모달 ----
  private modal: HTMLElement | null = null;
  closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }
  private openModal(title: string, build: (sheet: HTMLElement) => void): void {
    this.closeModal();
    const m = el('div', 'modal');
    const sheet = el('div', 'sheet');
    sheet.appendChild(el('h3', '', title));
    build(sheet);
    m.appendChild(sheet);
    m.addEventListener('pointerdown', (e) => {
      if (e.target === m) this.closeModal();
    });
    this.overlay.appendChild(m);
    this.modal = m;
  }

  pauseMenu(p: PlayScreen): void {
    sfx.click();
    this.app.ticker.speed = 0;
    this.openModal('일시정지', (s) => {
      const resume = el('button', 'btn primary', '계속하기');
      resume.onclick = () => {
        this.app.ticker.speed = 1;
        this.closeModal();
      };
      const home = el('button', 'btn secondary', '레벨 선택');
      home.onclick = () => {
        this.app.ticker.speed = 1;
        this.closeModal();
        this.showHome();
      };
      const snd = el('button', 'btn secondary', this.save.settings.sound ? '소리 끄기' : '소리 켜기');
      snd.onclick = () => {
        this.save.settings.sound = !this.save.settings.sound;
        setSound(this.save.settings.sound);
        writeSave(this.save);
        snd.textContent = this.save.settings.sound ? '소리 끄기' : '소리 켜기';
      };
      s.append(resume, home, snd);
    });
    void p;
  }

  hintMenu(p: PlayScreen): void {
    sfx.click();
    const id = p.level.levelId;
    const opened = this.save.hintUnlocked[id] ?? 0;
    const opts = [
      { stage: 1, label: '다음에 작동할 곳 보기', cost: 0 },
      { stage: 2, label: '추천 설치 영역', cost: 1 },
      { stage: 3, label: '검증된 배치 보기', cost: 2 },
    ];
    this.openModal('힌트', (s) => {
      for (const o of opts) {
        const done = opened >= o.stage;
        const b = el('button', `btn opt${done ? ' done' : ''}`, `<span>${o.stage}단계 · ${o.label}</span>`);
        const cost = el('span', 'cost', done ? '열림' : o.cost === 0 ? '무료' : '');
        if (!done && o.cost > 0) cost.append(icon('ui_token_hint'), document.createTextNode(String(o.cost)));
        b.appendChild(cost);
        b.disabled = !done && (o.stage > opened + 1 || this.save.hintTokens < o.cost);
        b.onclick = () => {
          if (!done) {
            this.save.hintTokens -= o.cost;
            this.save.hintUnlocked[id] = o.stage;
            writeSave(this.save);
            p.refreshTokens();
          }
          sfx.click();
          this.closeModal();
          p.showHint(Math.max(o.stage, opened));
          if (o.stage === 3) p.toast('유령 배치를 따라 놓거나, 힌트에서 바로 적용할 수 있어요', '', 2600);
        };
        s.appendChild(b);
      }
      if (opened >= 3) {
        const ap = el('button', 'btn primary', '배치 적용(되돌리기 가능)');
        ap.onclick = () => {
          this.closeModal();
          p.applySolution();
        };
        s.appendChild(ap);
      }
    });
  }

  onWin(p: PlayScreen, stars: number, objects: number): void {
    const id = p.level.levelId;
    const prev = this.save.levelProgress[id];
    const reward = clearReward(prev, stars);
    this.lastReward = reward;
    this.save.screws += reward;
    this.save.levelProgress[id] = mergeRecord(prev, stars, objects, p.level.version);
    this.save.editSnapshot = null;
    writeSave(this.save);
  }

  next(p: PlayScreen): void {
    sfx.click();
    if (p.index + 1 < this.levels.length) this.start(p.index + 1);
    else this.showHome();
  }

  /** 리플레이 영상 공유: 캔버스 녹화 → 공유 시트, 미지원이면 내려받기(6.5) */
  async shareReplay(p: PlayScreen): Promise<void> {
    sfx.click();
    const stream = (this.canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }).captureStream?.(30);
    if (!stream || typeof MediaRecorder === 'undefined') {
      p.toast('이 기기는 영상 저장을 지원하지 않아요', 'warn');
      return;
    }
    p.toast('리플레이를 녹화하는 중…', '', 6000);
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start();
    await new Promise((r) => setTimeout(r, 7000));
    rec.stop();
    await done;
    const file = new File(chunks, `squishy-cannon-lv${p.index + 1}.webm`, { type: 'video/webm' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `말랑 대포 대소동 레벨 ${p.index + 1}` }).catch(() => {});
    } else {
      const a = el('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
    }
    p.toast('저장했어요!', '', 1500);
  }
}

const game = new Game();
void game.init().then(() => {
  // ---- 자동 테스트·스크린샷 훅(e2e, shots) ----
  const w = window as unknown as Record<string, unknown>;
  w.__game = {
    ready: true,
    game,
    levels: LEVELS.length,
    state: () => ({
      screen: game.play ? 'play' : 'home',
      level: game.play ? game.play.index + 1 : 0,
      phase: game.play?.session.phase,
      result: game.play?.session.lastResult ?? null,
      inReplay: game.play?.inReplay ?? false,
      hash: game.play?.lastHash ?? '',
      edit: game.play?.session.edit,
      fxSpawned: game.play?.fx.spawned ?? 0,
      downs: game.play?.session.sim?.events.filter((e) => e.t === 'targetDown').length ?? 0,
      step: game.play?.session.sim?.step ?? 0,
      replayProgress: game.play?.replayProgress() ?? 0,
    }),
    /** 논리 좌표 → 화면(클라이언트) 좌표 */
    toClient: (lx: number, ly: number) => {
      const r = game.appEl.getBoundingClientRect();
      const s = r.width / W;
      return [r.left + lx * s, r.top + ly * s];
    },
    cannonHandle: () => {
      const [x, y] = game.play!.view.cannonHandlePos();
      return [x + 3, y + 66];
    },
    cannonPivot: () => {
      const [x, y] = game.play!.view.cannonPos();
      return [x + 3, y + 66];
    },
    solution: () => game.play?.level.solutions[0] ?? null,
    applySolution: () => game.play?.session.apply(solutionEdit(game.play.level.solutions[0]!)),
    start: (n: number) => game.start(n - 1),
    perfStart: () => {
      game.perf.frames = [];
      game.perf.work = [];
      game.perf.recording = true;
    },
    perfStop: () => {
      game.perf.recording = false;
      return { frames: game.perf.frames, work: game.perf.work };
    },
    /** 같은 브라우저에서 화면·이펙트 없이 돌린 순수 시뮬레이션 해시 */
    plainHash: (n: number) => {
      const l = LEVELS[n - 1]!;
      const sim = new Simulation(l, solutionEdit(l.solutions[0]!));
      sim.run();
      return sim.stateHash();
    },
    setSpeed: (s: 1 | 2) => {
      if (game.play && game.play.session.speed !== s) game.play.session.toggleSpeed();
    },
    resetSave: () => {
      localStorage.clear();
      game.save = loadSave();
    },
  };
  document.body.dataset.ready = '1';
});
