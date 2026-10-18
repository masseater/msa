import { defineDoc } from "@msa/durable";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { context, flush, openTestSession } from "./session-support.ts";

export type State = { value: number; retained: { label: string } };

export const StateDoc = defineDoc<State>({
  kind: "state.state",
  version: 1,
  scope: "session",
  initial: () => ({ value: 0, retained: { label: "stable" } }),
});

export const createState = Effect.fn("createState")(function* () {
  const harness = openTestSession();
  yield* awaited(harness.session.commit((tx) => tx.doc(StateDoc).then(() => undefined), context));
  yield* flush;
  return harness;
});
