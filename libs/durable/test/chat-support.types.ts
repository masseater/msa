import type { FauxProviderHandle, Models } from "@msa/ai";
import type { HarnessSettings, Registry } from "@msa/durable";
import type { Effect } from "effect";

declare namespace chatSupportTypes {
  type ChatSetup = {
    readonly faux: FauxProviderHandle;
    readonly models: Models;
    readonly registry: Registry;
    readonly reports: unknown[];
    readonly settings: { -readonly [K in keyof HarnessSettings]: HarnessSettings[K] };
    now: () => number;
  };

  type Check = Effect.Effect<boolean> | (() => boolean | Promise<boolean>);
}

export type { chatSupportTypes as default };
