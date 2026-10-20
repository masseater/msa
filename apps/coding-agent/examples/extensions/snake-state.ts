import { Effect, Random } from "effect";

export const GAME_WIDTH = 40;
export const GAME_HEIGHT = 15;
export const TICK_MS = 100;

export type Direction = "up" | "down" | "left" | "right";

export interface Point {
  x: number;
  y: number;
}

export interface GameState {
  snake: Point[];
  food: Point;
  direction: Direction;
  nextDirection: Direction;
  score: number;
  gameOver: boolean;
  highScore: number;
}

const randomInt = (max: number): number => Math.floor(Effect.runSync(Random.next) * max);

export function spawnFood(snake: Point[]): Point {
  let food: Point;
  do {
    food = { x: randomInt(GAME_WIDTH), y: randomInt(GAME_HEIGHT) };
  } while (snake.some((s) => s.x === food.x && s.y === food.y));
  return food;
}

export function createInitialState(): GameState {
  const startX = Math.floor(GAME_WIDTH / 2);
  const startY = Math.floor(GAME_HEIGHT / 2);
  return {
    direction: "right",
    food: spawnFood([{ x: startX, y: startY }]),
    gameOver: false,
    highScore: 0,
    nextDirection: "right",
    score: 0,
    snake: [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ],
  };
}

const nextHead = (head: Point, direction: Direction): Point => {
  switch (direction) {
    case "up":
      return { x: head.x, y: head.y - 1 };
    case "down":
      return { x: head.x, y: head.y + 1 };
    case "left":
      return { x: head.x - 1, y: head.y };
    case "right":
      return { x: head.x + 1, y: head.y };
  }
};

export function advance(state: GameState): void {
  state.direction = state.nextDirection;

  const head = state.snake[0];
  if (head === undefined) return;
  const newHead = nextHead(head, state.direction);

  if (newHead.x < 0 || newHead.x >= GAME_WIDTH || newHead.y < 0 || newHead.y >= GAME_HEIGHT) {
    state.gameOver = true;
    return;
  }

  if (state.snake.some((s) => s.x === newHead.x && s.y === newHead.y)) {
    state.gameOver = true;
    return;
  }

  state.snake.unshift(newHead);

  if (newHead.x === state.food.x && newHead.y === state.food.y) {
    state.score += 10;
    if (state.score > state.highScore) {
      state.highScore = state.score;
    }
    state.food = spawnFood(state.snake);
  } else {
    state.snake.pop();
  }
}
