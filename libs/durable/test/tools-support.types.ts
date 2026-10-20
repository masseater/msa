import type toolsSupport from "./tools-support.ts";
import type toolsTimeoutEnvSupportTypes from "./tools-timeout-env-support.types.ts";

declare namespace toolsSupportTypes {
  type BlockingWriteExecutionEnv = (typeof toolsSupport.BlockingWriteExecutionEnv)["prototype"];

  type TimeoutOutputExecutionEnv = toolsTimeoutEnvSupportTypes.TimeoutOutputExecutionEnv;
}

export type { toolsSupportTypes as default };
