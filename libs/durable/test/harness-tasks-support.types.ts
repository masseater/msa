import type durableTypes from "@msa/durable/index.types";
import type memoryTypes from "@msa/durable/storage/memory.types";

declare namespace harnessTasksSupportTypes {
  type Step = { phase: "run" };

  type StepRuntime<R> = durableTypes.TaskRuntime<null, Step, R, object>;

  type MemoryStorage = memoryTypes.MemoryStorage;
}

export type { harnessTasksSupportTypes as default };
