import type durableTypes from "@msa/durable/index.types";

declare namespace harnessOwnershipSupportTypes {
  type Ending = "completed" | "failed";

  type Tree = {
    owner: durableTypes.TaskId;
    child: durableTypes.ConversationId;
    inner: durableTypes.TaskId;
  };
}

export type { harnessOwnershipSupportTypes as default };
