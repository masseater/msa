import type envTypes from "../src/env/index.types.ts";
import type nodeTypes from "../src/env/node.types.ts";
import type toolsSupport from "./tools-support.ts";
import type toolsTimeoutEnvSupportTypes from "./tools-timeout-env-support.types.ts";

declare namespace toolsSupportTypes {
  type BlockingWriteExecutionEnv = (typeof toolsSupport.BlockingWriteExecutionEnv)["prototype"];

  type TimeoutOutputExecutionEnv = toolsTimeoutEnvSupportTypes.TimeoutOutputExecutionEnv;

  type NodeExecutionEnv = nodeTypes.NodeExecutionEnv;

  type ExecutionEnv = envTypes.ExecutionEnv;

  type FileError = envTypes.FileError;

  type Result<TValue, TError> = envTypes.Result<TValue, TError>;
}

export type { toolsSupportTypes as default };
