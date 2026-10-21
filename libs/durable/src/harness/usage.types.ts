import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";

declare namespace usageTypes {
  type UsageState = {
    models: Record<string, chordTypes.JsonRepresentation<aiTypes.Usage>>;
    tools: Record<string, chordTypes.JsonRepresentation<aiTypes.Usage>>;
  };
}

export type { usageTypes as default };
