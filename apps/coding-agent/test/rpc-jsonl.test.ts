import { EventEmitter } from "node:events";

import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { attachJsonlLineReader, serializeJsonLine } from "../src/modes/rpc/jsonl.ts";

const { fromJsonText, runTest } = testing;

type LineStream = Parameters<typeof attachJsonlLineReader>[0];

const chunkStream = (chunks: ReadonlyArray<string | Uint8Array>): LineStream => {
  const stream = new EventEmitter();
  queueMicrotask(() => {
    for (const chunk of chunks) stream.emit("data", chunk);
    stream.emit("end");
  });
  return stream as unknown as LineStream;
};

const collectLines = (chunks: ReadonlyArray<string | Uint8Array>): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const lines: string[] = [];
    const stream = chunkStream(chunks);
    const done = Effect.callback<void>((resume) => {
      stream.on("end", () => resume(Effect.void));
    });

    attachJsonlLineReader(stream, (line) => {
      lines.push(line);
    });

    yield* done;
    return lines;
  });

const serializesStrictJsonlRecordsWithoutEscapingUnicode = () =>
  runTest(
    Effect.gen(function* () {
      const line = serializeJsonLine({ text: "a\u2028b\u2029c" });

      expect(line).toContain("a\u2028b\u2029c");
      expect(line.endsWith("\n")).toBe(true);
      expect(yield* fromJsonText(line.trim())).toEqual({ text: "a\u2028b\u2029c" });
    }),
  );

const splitsOnLfOnlyAndPreservesU = () =>
  runTest(
    Effect.gen(function* () {
      const lines = yield* collectLines([serializeJsonLine({ text: "a\u2028b\u2029c" })]);

      expect(lines).toHaveLength(1);
      const [firstLine] = lines;
      if (firstLine === undefined) throw new Error("expected one JSONL line");
      expect(yield* fromJsonText(firstLine)).toEqual({ text: "a\u2028b\u2029c" });
    }),
  );

const handlesCrlfDelimitedInput = () =>
  runTest(
    Effect.gen(function* () {
      const lines = yield* collectLines([Buffer.from('{"a":1}\r\n{"b":2}\r\n')]);

      expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    }),
  );

const emitsAFinalLineWithoutTrailingLf = () =>
  runTest(
    Effect.gen(function* () {
      const lines = yield* collectLines([Buffer.from('{"a":1}')]);

      expect(lines).toEqual(['{"a":1}']);
    }),
  );

describe("RPC JSONL framing", () => {
  test(
    "serializes strict JSONL records without escaping Unicode separators",
    serializesStrictJsonlRecordsWithoutEscapingUnicode,
  );

  test(
    "splits on LF only and preserves U+2028/U+2029 inside payloads",
    splitsOnLfOnlyAndPreservesU,
  );

  test("handles CRLF-delimited input", handlesCrlfDelimitedInput);

  test("emits a final line without trailing LF", emitsAFinalLineWithoutTrailingLf);
});
