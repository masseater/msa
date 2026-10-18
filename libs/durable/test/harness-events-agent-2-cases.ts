import { type LiveState } from "@msa/durable";

export type LiveMessage = NonNullable<NonNullable<LiveState["generation"]>["message"]>;
