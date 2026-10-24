import type orchestratorTypesTypes from "./types.types.ts";

declare namespace goalCheckTextTypes {
  interface CheckResult {
    check: orchestratorTypesTypes.TaskCheck;
    exitCode: number | null;
    output: string;
    passed: boolean;
  }

  interface GateResult {
    task: orchestratorTypesTypes.Task;
    number: number | null;
    problems: readonly string[];
  }

  interface Verification {
    checks: readonly CheckResult[];
    pullRequests: readonly GateResult[];
  }
}

export type { goalCheckTextTypes as default };
