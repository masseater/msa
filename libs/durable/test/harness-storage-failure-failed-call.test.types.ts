import type harnessTypes from "@msa/durable/harness.types";
import type memoryTypes from "@msa/durable/storage/memory.types";

declare namespace harnessStorageFailureFailedCallTestTypes {
  type Harness = harnessTypes.Harness;

  type MemoryStorage = memoryTypes.MemoryStorage;
}

export type { harnessStorageFailureFailedCallTestTypes as default };
