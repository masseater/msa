import type { Context as ContextSource } from "@msa/chord";
import type { TaskRuntime } from "@msa/durable";
import type { Harness, createRegistry } from "@msa/durable/harness";
import type { Effect } from "effect";

import type harnessContextSupport from "./harness-context-support.ts";

declare namespace harnessContextSupportTypes {
  type Context = ContextSource;

  type Counting = Effect.Success<ReturnType<typeof harnessContextSupport.countingSetup>>;

  type RootHandles = {
    readonly harness: Harness;
    readonly registry: ReturnType<typeof createRegistry>;
    readonly root: Awaited<ReturnType<Harness["root"]>>;
  };

  type RunRuntime = TaskRuntime<Record<string, never>, { phase: "run" }, null, object>;
}

export type { harnessContextSupportTypes as default };
