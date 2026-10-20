import type { JsonValue } from "@msa/chord";
import type { Op } from "@msa/chord/delta";

import type typesModule from "./types.types.ts";

declare namespace documentsTypes {
  type AnyDocDefinition = typesModule.DocumentSemantics & {
    readonly kind: string;
    readonly version: number;
    readonly family?: true;
    initial(seed?: JsonValue): typesModule.JsonObject;
    migrate?(value: typesModule.JsonObject, fromVersion: number): typesModule.JsonObject;
    checkpointWhen?(
      value: Readonly<typesModule.JsonObject>,
      ops: readonly Op[],
      info: typesModule.CheckpointInfo,
    ): boolean;
  };

  type AnyDocToken = { readonly definition: AnyDocDefinition };

  type ResolvedAddress = {
    readonly address: typesModule.DocumentAddress;
    readonly id: string;
    readonly nextArgument: number;
  };
}

export type { documentsTypes as default };
