import { Effect } from "effect";

import type { FileInfo } from "../env/index.ts";
import {
  abortedContext,
  codeOf,
  context,
  decoder,
  encoder,
  type EnvCaseSpec,
  readAll,
  settled,
  value,
} from "./env-conformance-support.ts";

const byteRanges: EnvCaseSpec = {
  name: "binary reader reads byte ranges of the opened file",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("data.txt", "hello world", context));
      const reader = yield* value(() => env.openBinaryReader("data.txt", undefined, context));
      const info = yield* value(() => reader.info(context));
      assert.partialDeepEqual(info, { name: "data.txt", kind: "file", size: 11 });
      const read = (offset: number, length: number) =>
        value(() => reader.read(offset, length, context));
      assert.strictEqual(decoder.decode(yield* read(0, 5)), "hello");
      assert.strictEqual(decoder.decode(yield* read(6, 100)), "world");
      assert.strictEqual((yield* read(11, 4)).length, 0);
      assert.strictEqual((yield* read(50, 1)).length, 0);
      assert.strictEqual((yield* read(3, 0)).length, 0);
      assert.strictEqual(yield* codeOf(() => reader.read(-1, 1, context)), "invalid");
      assert.strictEqual(yield* codeOf(() => reader.read(0, 1.5, context)), "invalid");
      assert.strictEqual(yield* codeOf(() => reader.read(0, 1, abortedContext())), "aborted");
      yield* settled(() => reader.close(context));
      yield* settled(() => reader.close(context));
      assert.strictEqual(yield* codeOf(() => reader.read(0, 1, context)), "invalid");
      assert.strictEqual(yield* codeOf(() => reader.info(context)), "invalid");
    }),
};

const lineBytes = Uint8Array.from([
  0xef, 0xbb, 0xbf, 0x61, 0x0a, 0xe2, 0x82, 0x0a, 0x0a, 0xef, 0xbb, 0xbf, 0x62, 0x0a, 0xc3, 0xa9,
]);

const lineRanges: readonly (readonly [number, number | undefined])[] = [
  [0, undefined],
  [0, 1],
  [1, 3],
  [2, 3],
  [3, undefined],
  [4, 9],
];

const decodeSpan = (from: number, to: number): string =>
  new TextDecoder("utf-8", { ignoreBOM: from > 0 }).decode(lineBytes.subarray(from, to));

const scanLines: EnvCaseSpec = {
  name: "binary reader scans lines like decoding the whole file",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("lines.txt", lineBytes, context));
      const lines = new TextDecoder().decode(lineBytes).split("\n");
      const reader = yield* value(() => env.openBinaryReader("lines.txt", undefined, context));
      const scanned = Effect.gen(function* () {
        for (const [startLine, endLine] of lineRanges) {
          const range = { startLine, ...(endLine === undefined ? {} : { endLine }) };
          const scan = yield* value(() => reader.scanLines(range, context));
          const selected = lines.slice(startLine, endLine);
          assert.strictEqual(scan.newlines, lines.length - 1);
          assert.strictEqual(decodeSpan(scan.start, scan.end), selected.join("\n"));
          assert.strictEqual(scan.selectedBytes, encoder.encode(selected.join("\n")).length);
          assert.strictEqual(decodeSpan(scan.start, scan.firstLineEnd), lines[startLine]);
          assert.strictEqual(scan.firstLineBytes, encoder.encode(lines[startLine]).length);
        }
        assert.partialDeepEqual(yield* value(() => reader.scanLines({ startLine: 9 }, context)), {
          start: lineBytes.length,
          end: lineBytes.length,
          selectedBytes: 0,
        });
        assert.strictEqual(
          yield* codeOf(() => reader.scanLines({ startLine: 2, endLine: 2 }, context)),
          "invalid",
        );
      });
      yield* Effect.ensuring(
        scanned,
        settled(() => reader.close(context)),
      );
    }),
};

const afterRename: EnvCaseSpec = {
  name: "binary reader keeps reading the file it opened after a rename",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("a.txt", "one", context));
      const reader = yield* value(() => env.openBinaryReader("a.txt", undefined, context));
      yield* Effect.ensuring(
        Effect.gen(function* () {
          yield* value(() => env.renameFile("a.txt", "b.txt", context));
          yield* value(() => env.writeFile("a.txt", "two", context));
          assert.strictEqual(
            decoder.decode(yield* value(() => reader.read(0, 10, context))),
            "one",
          );
        }),
        settled(() => reader.close(context)),
      );
    }),
};

const binaryRefusals: EnvCaseSpec = {
  name: "binary reader refuses directories, missing files and aborted opens",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* value(() => env.createDir("dir", undefined, context));
      yield* value(() => env.writeFile("file.txt", "x", context));
      assert.strictEqual(
        yield* codeOf(() => env.openBinaryReader("dir", undefined, context)),
        "is_directory",
      );
      assert.strictEqual(
        yield* codeOf(() => env.openBinaryReader("missing.txt", undefined, context)),
        "not_found",
      );
      assert.strictEqual(
        yield* codeOf(() => env.openBinaryReader("file.txt", undefined, abortedContext())),
        "aborted",
      );
    }),
};

const directoryPages: EnvCaseSpec = {
  name: "directory reader pages every entry exactly once",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      const names = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
      for (const name of names) yield* value(() => env.writeFile(name, name, context));
      yield* value(() => env.createDir("sub", undefined, context));
      const { pages, done } = yield* readAll(env, ".", 2);
      assert.ok(done, "directory reader reached the end");
      for (const page of pages) assert.ok(page.length <= 2, "page within maxEntries");
      const entries = pages.flat();
      assert.deepEqual(entries.map((entry) => entry.name).sort(), [...names, "sub"].sort());
      assert.strictEqual(entries.find((entry) => entry.name === "sub")?.kind, "directory");
      assert.partialDeepEqual(
        entries.find((entry) => entry.name === "a.txt"),
        { kind: "file", size: 5 },
      );
    }),
};

const directoryEnd: EnvCaseSpec = {
  name: "directory reader reports the end and refuses use after close",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* value(() => env.createDir("empty", undefined, context));
      const reader = yield* value(() => env.openDirReader("empty", context));
      assert.deepEqual(yield* value(() => reader.next(10, context)), { entries: [], done: true });
      assert.deepEqual(yield* value(() => reader.next(10, context)), { entries: [], done: true });
      assert.strictEqual(yield* codeOf(() => reader.next(0, context)), "invalid");
      assert.strictEqual(yield* codeOf(() => reader.next(1, abortedContext())), "aborted");
      yield* settled(() => reader.close(context));
      yield* settled(() => reader.close(context));
      assert.strictEqual(yield* codeOf(() => reader.next(1, context)), "invalid");
    }),
};

const directoryRefusals: EnvCaseSpec = {
  name: "directory reader refuses missing paths and files",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("file.txt", "x", context));
      assert.strictEqual(yield* codeOf(() => env.openDirReader("missing", context)), "not_found");
      assert.strictEqual(
        yield* codeOf(() => env.openDirReader("file.txt", context)),
        "not_directory",
      );
      assert.strictEqual(yield* codeOf(() => env.openDirReader(".", abortedContext())), "aborted");
    }),
};

const removedDuringEnumeration: EnvCaseSpec = {
  name: "directory reader skips entries removed during enumeration",
  test: (env, { assert }) =>
    Effect.gen(function* () {
      yield* value(() => env.createDir("dir", undefined, context));
      for (const name of ["x", "y", "z"])
        yield* value(() => env.writeFile(`dir/${name}`, name, context));
      const reader = yield* value(() => env.openDirReader("dir", context));
      const enumerated = Effect.gen(function* () {
        for (const name of ["x", "y", "z"])
          yield* value(() => env.remove(`dir/${name}`, undefined, context));
        const entries: FileInfo[] = [];
        for (let read = 0; read < 10; read += 1) {
          const next = yield* value(() => reader.next(10, context));
          entries.push(...next.entries);
          if (next.done) break;
        }
        assert.deepEqual(entries, []);
      });
      yield* Effect.ensuring(
        enumerated,
        settled(() => reader.close(context)),
      );
    }),
};

export const readerCases: readonly EnvCaseSpec[] = [
  byteRanges,
  scanLines,
  afterRename,
  binaryRefusals,
  directoryPages,
  directoryEnd,
  directoryRefusals,
  removedDuringEnumeration,
];

export const followSymlinks: EnvCaseSpec = {
  name: "binary reader follows symlinks unless noFollow refuses the final one",
  test: (env, { assert, shell }) =>
    Effect.gen(function* () {
      yield* value(() => env.writeFile("target.txt", "target", context));
      yield* value(() => env.createDir("sub", undefined, context));
      yield* value(() => env.writeFile("sub/inner.txt", "inner", context));
      const linked = yield* value(() =>
        env.exec([...shell, "ln -s target.txt link.txt && ln -s sub dirlink"], undefined, context),
      );
      assert.strictEqual(linked.exitCode, 0);

      const followed = yield* value(() => env.openBinaryReader("link.txt", undefined, context));
      assert.strictEqual(
        decoder.decode(yield* value(() => followed.read(0, 10, context))),
        "target",
      );
      yield* settled(() => followed.close(context));

      assert.strictEqual(
        yield* codeOf(() => env.openBinaryReader("link.txt", { noFollow: true }, context)),
        "invalid",
      );

      const inner = yield* value(() =>
        env.openBinaryReader("dirlink/inner.txt", { noFollow: true }, context),
      );
      assert.strictEqual(decoder.decode(yield* value(() => inner.read(0, 10, context))), "inner");
      yield* settled(() => inner.close(context));
    }),
};
