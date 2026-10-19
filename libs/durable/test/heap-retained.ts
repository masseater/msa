import { Session } from "node:inspector/promises";

import { Effect } from "effect";

import { fromJsonText, awaited } from "./effect-support.ts";

export const retainedBytes = Effect.fn("retainedBytes")(function* () {
  const inspector = new Session();
  inspector.connect();
  const chunks: string[] = [];
  inspector.on("HeapProfiler.addHeapSnapshotChunk", (message) => chunks.push(message.params.chunk));
  yield* Effect.asVoid(
    Effect.suspend(() =>
      awaited(inspector.post("HeapProfiler.takeHeapSnapshot", { reportProgress: false })),
    ),
  ).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        inspector.disconnect();
      }),
    ),
  );
  const snapshot = (yield* fromJsonText(chunks.join(""))) as {
    snapshot: { meta: { node_fields: string[] } };
    nodes: number[];
  };
  const fields = snapshot.snapshot.meta.node_fields;
  const width = fields.length;
  const size = fields.indexOf("self_size");
  let total = 0;
  for (let index = size; index < snapshot.nodes.length; index += width)
    total += snapshot.nodes[index]!;
  return total;
});
