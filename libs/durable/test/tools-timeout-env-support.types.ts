import type toolsTimeoutEnvSupport from "./tools-timeout-env-support.ts";

declare namespace toolsTimeoutEnvSupportTypes {
  type TimeoutOutputExecutionEnv =
    (typeof toolsTimeoutEnvSupport.TimeoutOutputExecutionEnv)["prototype"];
}

export type { toolsTimeoutEnvSupportTypes as default };
