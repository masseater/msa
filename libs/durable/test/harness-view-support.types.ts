import type { Op } from "@msa/chord/delta";
import type { ConversationView } from "@msa/durable";

declare namespace harnessViewSupportTypes {
  type Frame = { value: ConversationView; ops: readonly Op[] };
}

export type { harnessViewSupportTypes as default };
