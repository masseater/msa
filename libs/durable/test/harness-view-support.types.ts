import type { Op } from "@msa/chord/delta";
import type durableTypes from "@msa/durable/index.types";

declare namespace harnessViewSupportTypes {
  type Frame = { value: durableTypes.ConversationView; ops: readonly Op[] };
}

export type { harnessViewSupportTypes as default };
