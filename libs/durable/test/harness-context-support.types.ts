import type { Context as ContextSource } from "@msa/chord";
import type harnessModule from "@msa/durable/harness";
import type harnessTypes from "@msa/durable/harness.types";
import type durableTypes from "@msa/durable/index.types";
import type { Effect } from "effect";

import type harnessContextSupport from "./harness-context-support.ts";

declare namespace harnessContextSupportTypes {
  type Context = ContextSource;

  type Counting = Effect.Success<ReturnType<typeof harnessContextSupport.countingSetup>>;

  type RootHandles = {
    readonly harness: harnessTypes.Harness;
    readonly registry: ReturnType<typeof harnessModule.createRegistry>;
    readonly root: Awaited<ReturnType<harnessTypes.Harness["root"]>>;
  };

  type RunRuntime = durableTypes.TaskRuntime<Record<string, never>, { phase: "run" }, null, object>;

  type ContextView = durableTypes.ContextView;

  type EntryDraft = durableTypes.EntryDraft;

  type EntryRecord = durableTypes.EntryRecord;

  type HarnessSettings = durableTypes.HarnessSettings;

  type Storage = durableTypes.Storage;
}

export type { harnessContextSupportTypes as default };
