import { fromJsonText, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { attachJsonlLineReader, serializeJsonLine } from "../src/modes/rpc/jsonl.ts";

type LineStream = Parameters<typeof attachJsonlLineReader>[0];

const nodeStream = process.getBuiltinModule("node:stream");

const collectLines = (chunks: ReadonlyArray<string | Uint8Array>): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const lines: string[] = [];
    const stream = nodeStream.Readable.from(chunks) as LineStream;
    const done = Effect.callback<void>((resume) => {
      stream.on("end", () => resume(Effect.void));
    });

    attachJsonlLineReader(stream, (line) => {
      lines.push(line);
    });

    yield* done;
    return lines;
  });

describe("RPC JSONL framing", () => {
  test("serializes strict JSONL records without escaping Unicode separators", () =>
    runTest(
      Effect.gen(function* () {
        const line = serializeJsonLine({ text: "a\u2028b\u2029c" });

        expect(line).toContain("a\u2028b\u2029c");
        expect(line.endsWith("\n")).toBe(true);
        expect(yield* fromJsonText(line.trim())).toEqual({ text: "a\u2028b\u2029c" });
      }),
    ));

  test("splits on LF only and preserves U+2028/U+2029 inside payloads", () =>
    runTest(
      Effect.gen(function* () {
        const lines = yield* collectLines([serializeJsonLine({ text: "a\u2028b\u2029c" })]);

        expect(lines).toHaveLength(1);
        const [firstLine] = lines;
        if (firstLine === undefined) throw new Error("expected one JSONL line");
        expect(yield* fromJsonText(firstLine)).toEqual({ text: "a\u2028b\u2029c" });
      }),
    ));

  test("handles CRLF-delimited input", () =>
    runTest(
      Effect.gen(function* () {
        const lines = yield* collectLines([Buffer.from('{"a":1}\r\n{"b":2}\r\n')]);

        expect(lines).toEqual(['{"a":1}', '{"b":2}']);
      }),
    ));

  test("emits a final line without trailing LF", () =>
    runTest(
      Effect.gen(function* () {
        const lines = yield* collectLines([Buffer.from('{"a":1}')]);

        expect(lines).toEqual(['{"a":1}']);
      }),
    ));
});
