import type { ToolRegistration } from "@msa/durable";

declare namespace harnessRegistrySupportTypes {
  type AppTool = ToolRegistration & { readonly snippet?: string };
}

export type { harnessRegistrySupportTypes as default };
