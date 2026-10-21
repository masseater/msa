import type handoffRenderTypes from "./handoff-render.types.ts";

declare namespace handoffTypes {
  interface HandoffInput extends handoffRenderTypes.HandoffSections {
    path?: string;
  }

  interface HandoffResult {
    path: string;
    tasks: number;
    running: number;

    line: string;

    notice: string | undefined;
  }
}

export type { handoffTypes as default };
