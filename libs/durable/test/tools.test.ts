import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import envModule from "../src/env/index.ts";
import type nodeTypes from "../src/env/node.types.ts";
import image from "../src/tools/image.ts";
import toolsModule from "../src/tools/index.ts";
import support from "./support.ts";
import diagnosticText from "./tools-cases.ts";
import toolsSupport from "./tools-support.ts";

const { createReadTool, createWriteTool } = toolsModule;
const { getOrThrow } = envModule;
const { detectSupportedImageMimeType } = image;

const { BACKGROUND_CONTEXT, abortController, appendTempFile, awaited, withAbortSignal } = support;
const {
  BlockingWriteExecutionEnv,
  createEnv,
  createTempDir,
  delay,
  removeTempDirs,
  run,
  textOutput,
} = toolsSupport;

afterAll(() => Effect.runPromise(removeTempDirs));

const failOrdinaryError = Effect.asVoid(
  Effect.suspend(() =>
    awaited(
      expect(run(createReadTool(), { path: "x" }, undefined)).rejects.toThrow(
        "No execution environment",
      ),
    ),
  ),
);

describe("durable tools", () => {
  it("fail with an ordinary error when no environment is configured", () =>
    Effect.runPromise(failOrdinaryError));
});

const readsTextOffsets = Effect.gen(function* () {
  const env = yield* createEnv;
  getOrThrow(
    yield* awaited(
      env.writeFile(
        "test.txt",
        Array.from({ length: 100 }, (_, index) => `Line ${index + 1}`).join("\n"),
        BACKGROUND_CONTEXT,
      ),
    ),
  );
  const result = yield* awaited(
    run(createReadTool(), { limit: 20, offset: 41, path: "test.txt" }, env),
  );
  const output = textOutput(result);
  expect(output).not.toContain("Line 40");
  expect(output).toContain("Line 41");
  expect(output).toContain("Line 60");
  expect(output).not.toContain("Line 61");
  expect(output).not.toContain("more lines");
  expect(diagnosticText(result)).toBe("40 more lines in file. Use offset=61 to continue.");
});

const truncatesLargeText = Effect.gen(function* () {
  const env = yield* createEnv;
  getOrThrow(
    yield* awaited(
      env.writeFile(
        "large.txt",
        Array.from({ length: 2500 }, (_, index) => `Line ${index + 1}`).join("\n"),
        BACKGROUND_CONTEXT,
      ),
    ),
  );
  const result = yield* awaited(run(createReadTool(), { path: "large.txt" }, env));
  expect(diagnosticText(result)).toBe("Showing lines 1-2000 of 2500. Use offset=2001 to continue.");
  expect(result.diagnostics?.[0]?.code).toBe("truncated");
  expect((result.details as { truncation?: unknown } | undefined)?.truncation).toMatchObject({
    outputLines: 2000,
    totalLines: 2500,
    truncated: true,
    truncatedBy: "lines",
  });
});

describe("durable tools", () => {
  describe("read", () => {
    it.each(["GIF87a", "GIF89a"])("detects the complete %s signature", (signature) => {
      expect(detectSupportedImageMimeType(Buffer.from(signature, "ascii"))).toBe("image/gif");
    });

    it("reads text with offsets and limits and reports continuation as a diagnostic", () =>
      Effect.runPromise(readsTextOffsets));

    it("truncates large text by line count", () => Effect.runPromise(truncatesLargeText));
  });
});

const doesNotCount = Effect.gen(function* () {
  const env = yield* createEnv;
  getOrThrow(
    yield* awaited(
      env.writeFile(
        "exact.txt",
        `${Array.from({ length: 2000 }, () => "x").join("\n")}\n`,
        BACKGROUND_CONTEXT,
      ),
    ),
  );
  const result = yield* awaited(run(createReadTool(), { path: "exact.txt" }, env));
  expect(result.details).toBeUndefined();
  expect(result.diagnostics).toEqual([]);
});

const showsStartLine = Effect.gen(function* () {
  const env = yield* createEnv;
  getOrThrow(
    yield* awaited(env.writeFile("long.txt", `${"é".repeat(40_000)}\nnext\n`, BACKGROUND_CONTEXT)),
  );
  const result = yield* awaited(run(createReadTool(), { path: "long.txt" }, env));
  const text = textOutput(result);
  expect(text).toBe("é".repeat(25_600));
  expect(diagnosticText(result)).toBe(
    "Line 1 is 78.1KB, exceeds the 50.0KB limit; showing its first 50.0KB. Use bash: sed -n '1p' long.txt | tail -c +51201",
  );
  expect((result.details as { truncation: object }).truncation).toMatchObject({
    firstLineExceedsLimit: true,
    outputBytes: 51_200,
    outputLines: 1,
    truncated: true,
  });
  expect(result.details).not.toHaveProperty("truncation.content");
});

const rejectsOffsetsBeyond = Effect.gen(function* () {
  const env = yield* createEnv;
  getOrThrow(yield* awaited(env.writeFile("short.txt", "one\ntwo\nthree", BACKGROUND_CONTEXT)));
  yield* awaited(
    expect(run(createReadTool(), { offset: 100, path: "short.txt" }, env)).rejects.toThrow(
      "Offset 100 is beyond end of file (3 lines total)",
    ),
  );
});

describe("durable tools", () => {
  describe("read", () => {
    it("does not count a trailing newline as an extra line at the truncation limit", () =>
      Effect.runPromise(doesNotCount));

    it("shows the start of a line longer than the byte limit", () =>
      Effect.runPromise(showsStartLine));

    it("rejects offsets beyond the file", () => Effect.runPromise(rejectsOffsetsBeyond));
  });
});

const readsLogGrows = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const env = yield* createEnv;
  getOrThrow(yield* awaited(env.writeFile("app.log", "one\ntwo\n", BACKGROUND_CONTEXT)));
  const growing = Object.create(env) as nodeTypes.NodeExecutionEnv;
  growing.openBinaryReader = (path, options, context) =>
    runPromise(
      Effect.gen(function* () {
        const opened = yield* awaited(env.openBinaryReader(path, options, context));
        if (!opened.ok) return opened;
        const reader = opened.value;
        const read = reader.read.bind(reader);
        reader.read = (position, length, readContext) =>
          runPromise(
            appendTempFile(env.cwd, "app.log", "more\n").pipe(
              Effect.andThen(Effect.suspend(() => awaited(read(position, length, readContext)))),
            ),
          );
        return opened;
      }),
    );
  const result = yield* awaited(run(createReadTool(), { limit: 2, path: "app.log" }, growing));
  expect(textOutput(result)).toBe("one\ntwo");
});

const returnsImagesContent = Effect.gen(function* () {
  const env = yield* createEnv;
  const data =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
  getOrThrow(
    yield* awaited(
      env.writeFile("image.txt", Uint8Array.from(Buffer.from(data, "base64")), BACKGROUND_CONTEXT),
    ),
  );
  const result = yield* awaited(run(createReadTool(), { path: "image.txt" }, env));
  expect(result.output).toEqual([{ data, mimeType: "image/png", type: "image" }]);
  expect(result.isError).toBeUndefined();
  expect(diagnosticText(result)).toBe("Read image file [image/png].");
});

describe("durable tools", () => {
  describe("read", () => {
    it("reads a log that grows while it is read", () => Effect.runPromise(readsLogGrows));

    it("returns images by content as one image block", () =>
      Effect.runPromise(returnsImagesContent));
  });
});

const writesFilesCreates = Effect.gen(function* () {
  const env = yield* createEnv;
  const result = yield* awaited(
    run(createWriteTool(), { content: "hello", path: "nested/dir/file.txt" }, env),
  );
  expect(textOutput(result)).toBe("Successfully wrote to nested/dir/file.txt");
  expect(
    getOrThrow(yield* awaited(env.readTextFile("nested/dir/file.txt", BACKGROUND_CONTEXT))),
  ).toBe("hello");
});

const keepsMutationQueue = Effect.gen(function* () {
  const env = new BlockingWriteExecutionEnv({ cwd: yield* createTempDir });
  const tool = createWriteTool();
  const controller = abortController();
  const firstWrite = run(
    tool,
    { content: "first\n", path: "file.txt" },
    env,
    withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
  );
  yield* awaited(env.firstWriteStarted.promise);
  controller.abort();
  const secondWrite = run(tool, { content: "second\n", path: "file.txt" }, env);
  yield* awaited(delay(20));
  expect(env.secondWriteStarted).toBe(false);
  env.finishFirstWrite.resolve();
  yield* awaited(expect(firstWrite).rejects.toThrow());
  yield* awaited(secondWrite);
  expect(getOrThrow(yield* awaited(env.readTextFile("file.txt", BACKGROUND_CONTEXT)))).toBe(
    "second\n",
  );
});

describe("durable tools", () => {
  describe("write", () => {
    it("writes files and creates parent directories", () => Effect.runPromise(writesFilesCreates));

    it("keeps the mutation queue locked until an aborted write settles", () =>
      Effect.runPromise(keepsMutationQueue));
  });
});
