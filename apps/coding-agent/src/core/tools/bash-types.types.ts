import type { Fiber } from "effect";
import type { Static } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type bashOperationsTypes from "./bash-operations.types.ts";
import type bashTypes from "./bash-types.ts";

declare namespace bashTypesTypes {
  type BashToolInput = Static<typeof bashTypes.bashSchema>;

  type BashToolOutput = Static<typeof bashTypes.bashOutputSchema>;

  interface BashSpawnContext {
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
  }

  type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

  interface SpawnContextInput {
    command: string;
    cwd: string;
    spawnHook: BashSpawnHook | undefined;
    exposeSessionEnvironment: boolean;
    ctx: extensionsTypesTypes.ExtensionContext | undefined;
  }

  interface BashToolOptions {
    operations?: bashOperationsTypes.BashOperations;
    commandPrefix?: string | undefined;
    shellPath?: string | undefined;
    exposeSessionEnvironment?: boolean;
    spawnHook?: BashSpawnHook;
  }

  type BashRenderState = {
    startedAt: number | undefined;
    endedAt: number | undefined;
    interval: Fiber.Fiber<never> | undefined;
  };

  interface ShellToolConfig {
    name: string;
    label: string;
    shellName: string;
    prompt: string;
    promptSnippet: string;
    promptGuidelines?: readonly string[];
    tempFilePrefix: string;
  }
}

export type { bashTypesTypes as default };
