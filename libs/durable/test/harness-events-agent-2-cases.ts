import type durableTypes from "@msa/durable/index.types";

declare namespace harnessEventsAgent2CasesTypes {
  type LiveMessage = NonNullable<NonNullable<durableTypes.LiveState["generation"]>["message"]>;
}

export type { harnessEventsAgent2CasesTypes as default };
