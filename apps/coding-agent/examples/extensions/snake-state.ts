import { Effect, Random } from "effect";

import type snakeStateTypes from "./snake-state.types.ts";

const GAME_WIDTH = 40;
const GAME_HEIGHT = 15;
const TICK_MS = 100;

const randomInt = (max: number): number => Math.floor(Effect.runSync(Random.next) * max);

function spawnFood(snake: snakeStateTypes.Point[]): snakeStateTypes.Point {
  let food: snakeStateTypes.Point;
  do {
    food = { x: randomInt(GAME_WIDTH), y: randomInt(GAME_HEIGHT) };
  } while (snake.some((s) => s.x === food.x && s.y === food.y));
  return food;
}

function createInitialState(): snakeStateTypes.GameState {
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

const nextHead = (
  head: snakeStateTypes.Point,
  direction: snakeStateTypes.Direction,
): snakeStateTypes.Point => {
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

function advance(state: snakeStateTypes.GameState): void {
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

const snakeState = {
  GAME_HEIGHT,
  GAME_WIDTH,
  TICK_MS,
  advance,
  createInitialState,
  spawnFood,
};

export default snakeState;
