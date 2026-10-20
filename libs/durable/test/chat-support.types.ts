import type aiTypes from "@msa/ai/index.types";
import type durableTypes from "@msa/durable/index.types";
import type { Effect } from "effect";

declare namespace chatSupportTypes {
  type ChatSetup = {
    readonly faux: aiTypes.FauxProviderHandle;
    readonly models: aiTypes.Models;
    readonly registry: durableTypes.Registry;
    readonly reports: unknown[];
    readonly settings: {
      -readonly [K in keyof durableTypes.HarnessSettings]: durableTypes.HarnessSettings[K];
    };
    now: () => number;
  };

  type Check = Effect.Effect<boolean> | (() => boolean | Promise<boolean>);
}

export type { chatSupportTypes as default };
