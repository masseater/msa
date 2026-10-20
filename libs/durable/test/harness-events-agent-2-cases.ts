import { type LiveState } from "@msa/durable";

declare namespace harnessEventsAgent2CasesTypes {
  type LiveMessage = NonNullable<NonNullable<LiveState["generation"]>["message"]>;
}

export type { harnessEventsAgent2CasesTypes as default };
