import type { Usage } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";

declare namespace usageTypes {
  type UsageState = {
    models: Record<string, chordTypes.JsonRepresentation<Usage>>;
    tools: Record<string, chordTypes.JsonRepresentation<Usage>>;
  };
}

export type { usageTypes as default };
