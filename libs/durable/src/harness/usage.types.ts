import type { Usage } from "@msa/ai";
import type { JsonRepresentation } from "@msa/chord";

declare namespace usageTypes {
  type UsageState = {
    models: Record<string, JsonRepresentation<Usage>>;
    tools: Record<string, JsonRepresentation<Usage>>;
  };
}

export type { usageTypes as default };
