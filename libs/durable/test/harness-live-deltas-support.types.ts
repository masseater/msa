import type deltaTypes from "@msa/chord/delta.types";
import type durableTypes from "@msa/durable/index.types";

declare namespace harnessLiveDeltasSupportTypes {
  type Op = deltaTypes.Op;

  type Action = (api: durableTypes.ToolExecutionApi) => void | Promise<void>;
}

export type { harnessLiveDeltasSupportTypes as default };
