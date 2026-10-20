import type { Draft } from "@msa/chord";
import { defineDoc } from "@msa/durable";
import { Effect } from "effect";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";
import type sessionWatchesSupportTypes from "./session-watches-support.types.ts";

const { awaited } = effectSupport;
const { context, openTestSession } = sessionSupport;

const StateDoc = defineDoc<sessionWatchesSupportTypes.State>({
  initial: () => ({ items: ["a", "b"], retained: { label: "stable" }, value: 0 }),
  kind: "watch.state",
  scope: "session",
  version: 1,
});

function deferred(): sessionWatchesSupportTypes.Deferred {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, resolve };
}

const createState = Effect.fn("createState")(function* () {
  const harness = openTestSession();
  yield* awaited(harness.session.commit((tx) => tx.doc(StateDoc).then(() => undefined), context));
  return harness;
});

const writeState = Effect.fn("writeState")(function* (
  session: ReturnType<typeof openTestSession>["session"],
  edit: (state: Draft<sessionWatchesSupportTypes.State>) => void,
) {
  yield* awaited(session.commit((tx) => tx.doc(StateDoc).then(edit), context));
});

const sessionWatchesSupport = {
  StateDoc,
  createState,
  deferred,
  writeState,
};

export default sessionWatchesSupport;
