import type snakeStateTypes from "./snake-state.types.ts";

declare namespace snakeRenderTypes {
  interface FrameOptions {
    readonly state: snakeStateTypes.GameState;
    readonly paused: boolean;
    readonly width: number;
  }
}

export type { snakeRenderTypes as default };
