import type durableTypes from "@msa/durable/index.types";

declare namespace harnessRegistrySupportTypes {
  type AppTool = durableTypes.ToolRegistration & { readonly snippet?: string };
}

export type { harnessRegistrySupportTypes as default };
