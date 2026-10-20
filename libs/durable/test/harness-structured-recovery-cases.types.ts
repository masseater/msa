import type { TaskId } from "@msa/durable";

declare namespace harnessStructuredRecoveryCasesTypes {
  type Seeded = { parent: TaskId; children: TaskId[] };
}

export type { harnessStructuredRecoveryCasesTypes as default };
