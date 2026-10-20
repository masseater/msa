import durable from "@msa/durable";
import { Effect } from "effect";

import effectSupport from "./effect-support.ts";
import type sessionStatesCasesTypes from "./session-states-cases.types.ts";
import sessionSupport from "./session-support.ts";

const { defineDoc } = durable;

const { awaited } = effectSupport;
const { context, flush, openTestSession } = sessionSupport;

const StateDoc = defineDoc<sessionStatesCasesTypes.State>({
  initial: () => ({ retained: { label: "stable" }, value: 0 }),
  kind: "state.state",
  scope: "session",
  version: 1,
});

const createState = Effect.fn("createState")(function* () {
  const harness = openTestSession();
  yield* awaited(harness.session.commit((tx) => tx.doc(StateDoc).then(() => undefined), context));
  yield* flush;
  return harness;
});

const sessionStatesCases = {
  StateDoc,
  createState,
};

export default sessionStatesCases;
