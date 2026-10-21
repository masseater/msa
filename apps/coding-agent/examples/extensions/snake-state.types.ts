declare namespace snakeStateTypes {
  type Direction = "up" | "down" | "left" | "right";

  interface Point {
    x: number;
    y: number;
  }

  interface GameState {
    snake: Point[];
    food: Point;
    direction: Direction;
    nextDirection: Direction;
    score: number;
    gameOver: boolean;
    highScore: number;
  }
}

export type { snakeStateTypes as default };
