import type { TaskRuntime } from "@msa/durable";

declare namespace harnessTasksSupportTypes {
  type Step = { phase: "run" };

  type StepRuntime<R> = TaskRuntime<null, Step, R, object>;
}

export type { harnessTasksSupportTypes as default };
