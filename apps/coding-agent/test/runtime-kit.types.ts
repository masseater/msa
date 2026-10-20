import type compat from "@msa/ai/compat";

import type { ExtensionFactory } from "../src/index.ts";

declare namespace runtimeKitTypes {
  type Faux = ReturnType<typeof compat.registerFauxProvider>;

  interface FauxRuntimeOptions {
    readonly agentDir?: string;
    readonly bootstrapModel?: boolean;
    readonly commandActions?: boolean;
    readonly cwd?: string;
    readonly extensionFactory?: ExtensionFactory;
    readonly faux?: Faux;
    readonly inMemory?: boolean;
    readonly models?: { id: string; reasoning: boolean }[];
    readonly providerViaExtension?: boolean;
    readonly responses?: string[];
  }
}

export type { runtimeKitTypes as default };
