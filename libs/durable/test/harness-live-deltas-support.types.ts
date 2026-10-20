import type { Op as OpSource } from "@msa/chord/delta";
import type durableTypes from "@msa/durable/index.types";

declare namespace harnessLiveDeltasSupportTypes {
  type Op = OpSource;

  type Action = (api: durableTypes.ToolExecutionApi) => void | Promise<void>;
}

export type { harnessLiveDeltasSupportTypes as default };
