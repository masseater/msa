import type deltaTypes from "@msa/chord/delta.types";
import type durableTypes from "@msa/durable/index.types";

declare namespace harnessViewSupportTypes {
  type Frame = { value: durableTypes.ConversationView; ops: readonly deltaTypes.Op[] };
}

export type { harnessViewSupportTypes as default };
