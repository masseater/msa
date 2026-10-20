import { Effect, Random } from "effect";

export const GAME_WIDTH = 60;
export const GAME_HEIGHT = 24;
export const TICK_MS = 50;
export const PLAYER_Y = GAME_HEIGHT - 2;
const ALIEN_ROWS = 5;
const ALIEN_COLS = 11;
const ALIEN_START_Y = 2;

export type Point = { x: number; y: number };

export interface Bullet extends Point {
  direction: -1 | 1;
}

export interface Alien extends Point {
  type: 0 | 1 | 2;
  alive: boolean;
}

export interface Shield {
  x: number;
  segments: boolean[][];
}

export interface GameState {
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

export interface KeyState {
  left: boolean;
  right: boolean;
  fire: boolean;
}

export interface Counters {
  fireCooldown: number;
  playerMoveCounter: number;
}

const createShields = (): Shield[] =>
  [8, 22, 36, 50].map((x) => ({
    segments: [
      [true, true, true, true],
      [true, true, true, true],
      [true, false, false, true],
    ],
    x,
  }));

const createAliens = (): Alien[] => {
  const aliens: Alien[] = [];
  for (let row = 0; row < ALIEN_ROWS; row++) {
    const type = row === 0 ? 2 : row < 3 ? 1 : 0;
    for (let col = 0; col < ALIEN_COLS; col++) {
      aliens.push({ alive: true, type, x: 4 + col * 5, y: ALIEN_START_Y + row * 2 });
    }
  }
  return aliens;
};

export const createInitialState = (
  options: { readonly highScore?: number | undefined; readonly level?: number | undefined } = {},
): GameState => ({
  ...initialFields(options.highScore ?? 0, options.level ?? 1),
});

const initialFields = (highScore: number, level: number): GameState => ({
  alienDirection: 1,
  alienDropping: false,
  alienMoveCounter: 0,
  alienMoveDelay: Math.max(5, 20 - level * 2),
  alienShootCounter: 0,
  aliens: createAliens(),
  bullets: [],
  gameOver: false,
  highScore,
  level,
  player: { lives: 3, x: Math.floor(GAME_WIDTH / 2) },
  score: 0,
  shields: createShields(),
  victory: false,
});

const movePlayer = (state: GameState, keys: KeyState, counters: Counters): void => {
  counters.playerMoveCounter++;
  if (counters.playerMoveCounter < 2) return;

  counters.playerMoveCounter = 0;
  if (keys.left && state.player.x > 2) {
    state.player.x--;
  }
  if (keys.right && state.player.x < GAME_WIDTH - 3) {
    state.player.x++;
  }
};

const shootBullet = (state: GameState, keys: KeyState, counters: Counters): void => {
  if (counters.fireCooldown > 0) counters.fireCooldown--;
  if (!keys.fire || counters.fireCooldown !== 0) return;

  const playerBullets = state.bullets.filter((b) => b.direction === -1);
  if (playerBullets.length >= 2) return;

  state.bullets.push({ direction: -1, x: state.player.x, y: PLAYER_Y - 1 });
  counters.fireCooldown = 8;
};

const moveBullets = (state: GameState): void => {
  state.bullets = state.bullets.filter((bullet) => {
    bullet.y += bullet.direction;
    return bullet.y >= 0 && bullet.y < GAME_HEIGHT;
  });
};

const speedUpAliens = (state: GameState, aliveCount: number): void => {
  if (aliveCount <= 5) {
    state.alienMoveDelay = 1;
  } else if (aliveCount <= 10) {
    state.alienMoveDelay = 2;
  } else if (aliveCount <= 20) {
    state.alienMoveDelay = 3;
  }
};

const dropAliens = (state: GameState, aliveAliens: Alien[]): void => {
  for (const alien of aliveAliens) {
    alien.y++;
    if (alien.y >= PLAYER_Y - 1) {
      state.gameOver = true;
      return;
    }
  }
  state.alienDropping = false;
};

const moveAliens = (state: GameState): void => {
  const aliveAliens = state.aliens.filter((a) => a.alive);
  if (aliveAliens.length === 0) return;

  if (state.alienDropping) {
    dropAliens(state, aliveAliens);
  } else {
    const minX = Math.min(...aliveAliens.map((a) => a.x));
    const maxX = Math.max(...aliveAliens.map((a) => a.x));
    const hitEdge =
      (state.alienDirection === 1 && maxX >= GAME_WIDTH - 3) ||
      (state.alienDirection === -1 && minX <= 2);

    if (hitEdge) {
      state.alienDirection *= -1;
      state.alienDropping = true;
    } else {
      for (const alien of aliveAliens) {
        alien.x += state.alienDirection;
      }
    }
  }

  speedUpAliens(state, aliveAliens.length);
};

const randomInt = (max: number): number => Math.floor(Effect.runSync(Random.next) * max);

const alienShoot = (state: GameState): void => {
  const aliveAliens = state.aliens.filter((a) => a.alive);
  if (aliveAliens.length === 0) return;

  const columns = new Map<number, Alien>();
  for (const alien of aliveAliens) {
    const existing = columns.get(alien.x);
    if (existing === undefined || alien.y > existing.y) {
      columns.set(alien.x, alien);
    }
  }

  const shooters = Array.from(columns.values());
  if (shooters.length === 0 || state.bullets.filter((b) => b.direction === 1).length >= 3) return;

  const shooter = shooters[randomInt(shooters.length)];
  if (shooter !== undefined) {
    state.bullets.push({ direction: 1, x: shooter.x, y: shooter.y + 1 });
  }
};

const hitAlien = (state: GameState, bullet: Bullet): boolean => {
  for (const alien of state.aliens) {
    if (!alien.alive || Math.abs(bullet.x - alien.x) > 1 || bullet.y !== alien.y) continue;
    alien.alive = false;
    state.score += ([10, 20, 30] as const)[alien.type];
    if (state.score > state.highScore) {
      state.highScore = state.score;
    }
    return true;
  }
  return false;
};

const hitPlayer = (state: GameState, bullet: Bullet): boolean => {
  if (bullet.direction !== 1) return false;
  if (Math.abs(bullet.x - state.player.x) > 1 || bullet.y !== PLAYER_Y) return false;

  state.player.lives--;
  if (state.player.lives <= 0) {
    state.gameOver = true;
  }
  return true;
};

const hitShield = (state: GameState, bullet: Bullet): boolean => {
  for (const shield of state.shields) {
    const relX = bullet.x - shield.x;
    const relY = bullet.y - (PLAYER_Y - 5);
    if (relX < 0 || relX >= 4 || relY < 0 || relY >= 3) continue;

    const segmentRow = shield.segments[relY];
    if (segmentRow?.[relX] !== true) continue;

    segmentRow[relX] = false;
    return true;
  }
  return false;
};

const checkCollisions = (state: GameState): void => {
  const spent = new Set<Bullet>();
  for (const bullet of state.bullets) {
    if (bullet.direction === -1 && hitAlien(state, bullet)) {
      spent.add(bullet);
      continue;
    }
    if (hitPlayer(state, bullet) || hitShield(state, bullet)) {
      spent.add(bullet);
    }
  }
  state.bullets = state.bullets.filter((b) => !spent.has(b));
};

export const advance = (request: {
  readonly state: GameState;
  readonly keys: KeyState;
  readonly counters: Counters;
}): void => {
  const { state, keys, counters } = request;
  movePlayer(state, keys, counters);
  shootBullet(state, keys, counters);
  moveBullets(state);

  state.alienMoveCounter++;
  if (state.alienMoveCounter >= state.alienMoveDelay) {
    state.alienMoveCounter = 0;
    moveAliens(state);
  }

  state.alienShootCounter++;
  if (state.alienShootCounter >= 30) {
    state.alienShootCounter = 0;
    alienShoot(state);
  }

  checkCollisions(state);

  if (state.aliens.every((a) => !a.alive)) {
    state.victory = true;
  }
};
