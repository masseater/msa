import { defineDoc } from "@msa/durable";

import { context, openTestSession } from "./session-support.ts";

export type State = { value: number; items: string[]; retained: { label: string } };

export const StateDoc = defineDoc<State>({
  kind: "watch.state",
  version: 1,
  scope: "session",
  initial: () => ({ value: 0, items: ["a", "b"], retained: { label: "stable" } }),
});

export type Deferred = { readonly promise: Promise<void>; readonly resolve: () => void };

export function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function createState(): Promise<ReturnType<typeof openTestSession>> {
  const harness = openTestSession();
  await harness.session.commit((tx) => tx.doc(StateDoc).then(() => undefined), context);
  return harness;
}
