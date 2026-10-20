import type spaceInvadersStateTypes from "./space-invaders-state.types.ts";

declare namespace spaceInvadersRenderTypes {
  interface FrameOptions {
    readonly state: spaceInvadersStateTypes.GameState;
    readonly paused: boolean;
    readonly width: number;
  }
}

export type { spaceInvadersRenderTypes as default };
