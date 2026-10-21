import type nodeChildProcessTypes from "../core/platform/node/child-process.types.ts";

declare namespace childProcessTypes {
  type ChildProcess = nodeChildProcessTypes.ChildProcess;
}

export type { childProcessTypes as default };
