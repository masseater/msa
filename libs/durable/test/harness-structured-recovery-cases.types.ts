import type durableTypes from "@msa/durable/index.types";

declare namespace harnessStructuredRecoveryCasesTypes {
  type Seeded = { parent: durableTypes.TaskId; children: durableTypes.TaskId[] };
}

export type { harnessStructuredRecoveryCasesTypes as default };
