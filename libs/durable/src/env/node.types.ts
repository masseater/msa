import type node from "./node.ts";
import type nodeWatchTypes from "./node/node-watch.types.ts";

declare namespace nodeTypes {
  interface NodeExecutionEnvOptions {
    cwd: string;
    shellPath?: string;
    shellEnv?: NodeJS.ProcessEnv;
    watch?: nodeWatchTypes.NodeWatchOptions;
  }

  type NodeWatchOptions = nodeWatchTypes.NodeWatchOptions;

  type NodeExecutionEnv = (typeof node.NodeExecutionEnv)["prototype"];
}

export type { nodeTypes as default };
