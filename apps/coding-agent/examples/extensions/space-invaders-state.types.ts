declare namespace spaceInvadersStateTypes {
  type Point = { x: number; y: number };

  interface Bullet extends Point {
    direction: -1 | 1;
  }

  interface Alien extends Point {
    type: 0 | 1 | 2;
    alive: boolean;
  }

  interface Shield {
    x: number;
    segments: boolean[][];
  }

  interface GameState {
    player: { x: number; lives: number };
    aliens: Alien[];
    alienDirection: 1 | -1;
    alienMoveCounter: number;
    alienMoveDelay: number;
    alienDropping: boolean;
    bullets: Bullet[];
    shields: Shield[];
    score: number;
    highScore: number;
    level: number;
    gameOver: boolean;
    victory: boolean;
    alienShootCounter: number;
  }

  interface KeyState {
    left: boolean;
    right: boolean;
    fire: boolean;
  }

  interface Counters {
    fireCooldown: number;
    playerMoveCounter: number;
  }
}

export type { spaceInvadersStateTypes as default };
