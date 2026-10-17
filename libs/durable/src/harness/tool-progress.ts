import { type Context, copyJson, type JsonValue } from "@msa/chord";
import { overlap } from "@msa/chord/delta";
import { Progress } from "@msa/chord/output";
import { Effect, Function } from "effect";

import { utf8ByteLength } from "../truncate.ts";
import { commitTask } from "./bridge.ts";
import { assignJson } from "./json.ts";
import { LiveDoc, toolSlot } from "./live.ts";
import type { Reported, ToolRuntime } from "./tool-types.ts";
import type { Dual4, ToolDiagnostic, Tx } from "./types.ts";

type Written = {
  text: string;
  details: JsonValue | undefined;
  diagnostics: number;
};

type Snapshot = {
  readonly text: string;
  readonly droppedBytes: number;
  readonly droppedLines: number;
};

const countBytes = (
  snapshot: Snapshot,
  written: Written,
  current: Written,
  added: readonly ToolDiagnostic[],
): number => {
  let bytes = 0;
  if (snapshot.text !== written.text) {
    const shared = snapshot.text.startsWith(written.text)
      ? written.text.length
      : overlap(written.text, snapshot.text, 65_536);
    bytes += utf8ByteLength(snapshot.text.slice(shared));
  }
  if (current.details !== written.details)
    bytes += utf8ByteLength(JSON.stringify(current.details ?? null));
  if (added.length > 0) bytes += utf8ByteLength(JSON.stringify(added));
  return bytes;
};

const writeSlot = (
  tx: Tx,
  runtime: ToolRuntime,
  snapshot: Snapshot,
  current: Written,
  input: { readonly detailsChanged: boolean; readonly added: readonly ToolDiagnostic[] },
) =>
  Effect.gen(function* () {
    const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
    const slot = toolSlot(live, runtime.taskId);
    if (slot === undefined) return undefined;
    if ((slot.output ?? "") !== snapshot.text) slot.output = snapshot.text;
    if (snapshot.droppedBytes > 0) slot.droppedBytes = snapshot.droppedBytes;
    if (snapshot.droppedLines > 0) slot.droppedLines = snapshot.droppedLines;
    if (input.detailsChanged && current.details !== undefined)
      assignJson(slot as unknown as Record<string, JsonValue>, "details", current.details);
    if (input.added.length > 0) {
      slot.diagnostics ??= [];
      for (const diagnostic of input.added) slot.diagnostics.push(diagnostic);
    }
    return undefined;
  });

const publish = Effect.fn("publishToolProgress")(function* (
  runtime: ToolRuntime,
  reported: Reported,
  written: Written,
  context: Context,
) {
  const snapshot = reported.output.snapshot();
  const current: Written = {
    text: snapshot.text,
    details: reported.details,
    diagnostics: reported.diagnostics.length,
  };
  const added = reported.diagnostics.slice(written.diagnostics, current.diagnostics);
  const detailsChanged = current.details !== written.details;
  const bytes = countBytes(snapshot, written, current, added);
  yield* commitTask(
    runtime,
    (tx: Tx) => writeSlot(tx, runtime, snapshot, current, { detailsChanged, added }),
    context,
  );
  written.text = current.text;
  written.details = current.details;
  written.diagnostics = current.diagnostics;
  return bytes;
});

export const publishProgress: Dual4<ToolRuntime, Reported, boolean, Context, Progress> =
  Function.dual(
    4,
    (runtime: ToolRuntime, reported: Reported, enabled: boolean, context: Context): Progress => {
      const written: Written = { text: "", details: undefined, diagnostics: 0 };
      return new Progress(
        () =>
          enabled
            ? Effect.runPromise(publish(runtime, reported, written, context))
            : Promise.resolve(0),
        (error) => {
          if (!runtime.signal.aborted) runtime.report(error);
        },
        runtime.settings.progress.outputIntervalMs,
      );
    },
  );

export const copyDiagnostic = (diagnostic: ToolDiagnostic): ToolDiagnostic =>
  copyJson(diagnostic, { omitUndefinedProperties: true }) as ToolDiagnostic;
