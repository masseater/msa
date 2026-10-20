import type { Op as OpSource } from "@msa/chord/delta";
import type { ToolExecutionApi } from "@msa/durable";

declare namespace harnessLiveDeltasSupportTypes {
  type Op = OpSource;

  type Action = (api: ToolExecutionApi) => void | Promise<void>;
}

export type { harnessLiveDeltasSupportTypes as default };
