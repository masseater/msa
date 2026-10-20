import { type Context, type JsonValue, copyJson } from "@msa/chord";
import { overlap } from "@msa/chord/delta/overlap";
import { Progress } from "@msa/chord/progress";
import { Effect, Function } from "effect";

import truncate from "../truncate.ts";
import bridge from "./bridge.ts";
import json from "./json.ts";
import liveModule from "./live.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";

const { utf8ByteLength } = truncate;
const { LiveDoc, toolSlot } = liveModule;
const { assignJson } = json;
const { commitTask } = bridge;

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
  added: readonly typesModule.ToolDiagnostic[],
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
  tx: typesModule.Tx,
  runtime: toolTypesModule.ToolRuntime,
  snapshot: Snapshot,
  current: Written,
  input: {
    readonly detailsChanged: boolean;
    readonly added: readonly typesModule.ToolDiagnostic[];
  },
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

const publish = Effect.fnUntraced(function* (
  runtime: toolTypesModule.ToolRuntime,
  reported: toolTypesModule.Reported,
  written: Written,
  context: Context,
) {
  const snapshot = reported.output.snapshot();
  const current: Written = {
    details: reported.details,
    diagnostics: reported.diagnostics.length,
    text: snapshot.text,
  };
  const added = reported.diagnostics.slice(written.diagnostics, current.diagnostics);
  const detailsChanged = current.details !== written.details;
  const bytes = countBytes(snapshot, written, current, added);
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx) => writeSlot(tx, runtime, snapshot, current, { added, detailsChanged }),
    context,
  );
  written.text = current.text;
  written.details = current.details;
  written.diagnostics = current.diagnostics;
  return bytes;
});

const publishProgress: typesModule.Dual4<
  toolTypesModule.ToolRuntime,
  toolTypesModule.Reported,
  boolean,
  Context,
  Progress
> = Function.dual(
  4,
  (
    runtime: toolTypesModule.ToolRuntime,
    reported: toolTypesModule.Reported,
    enabled: boolean,
    context: Context,
  ): Progress => {
    const written: Written = { details: undefined, diagnostics: 0, text: "" };
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

const copyDiagnostic = (diagnostic: typesModule.ToolDiagnostic): typesModule.ToolDiagnostic =>
  copyJson(diagnostic, { omitUndefinedProperties: true }) as typesModule.ToolDiagnostic;

const toolProgress = {
  copyDiagnostic,
  publishProgress,
};

export default toolProgress;
