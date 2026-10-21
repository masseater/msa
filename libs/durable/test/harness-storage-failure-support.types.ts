import type harnessStorageFailureSupport from "./harness-storage-failure-support.ts";

declare namespace harnessStorageFailureSupportTypes {
  type FailingCalls = (typeof harnessStorageFailureSupport.FailingCalls)["prototype"];
}

export type { harnessStorageFailureSupportTypes as default };
