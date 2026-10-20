import type { ConversationId, TaskId } from "@msa/durable";

declare namespace harnessOwnershipSupportTypes {
  type Ending = "completed" | "failed";

  type Tree = { owner: TaskId; child: ConversationId; inner: TaskId };
}

export type { harnessOwnershipSupportTypes as default };
