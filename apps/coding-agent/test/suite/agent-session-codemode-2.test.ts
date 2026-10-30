import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import extension from "../../src/extensions/codemode/extension.ts";
import tool from "../../src/extensions/codemode/tool.ts";
import type codingAgentTypes from "../../src/index.types.ts";
import agentSessionCodemode2Support from "./agent-session-codemode-2-support.ts";
import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { cleanupAll } = harnessModule;

const { createCodemodeExtension } = extension;

const { CODEMODE_STORE_ENTRY_TYPE } = tool;

const { harnesses3, increment, setup3 } = agentSessionCodemode2Support;

const { TINY_PNG_BASE64, checkSavedImages, resultText, runCodemode, trackCodemodeWorkers } =
  agentSessionCodemodeSupport;

const { createHarness } = harnessModule;

const { fromJsonText, joinPath, readTextFile, removePath, writeBytesFile, writeTextFile } = testing;

trackCodemodeWorkers();

function storeEntries(harness: harnessTypes.Harness): unknown[] {
  return harness.sessionManager
    .getBranch()
    .filter(
      (entry): entry is codingAgentTypes.CustomEntry =>
        entry.type === "custom" && entry.customType === CODEMODE_STORE_ENTRY_TYPE,
    )
    .map((entry) => entry.data);
}

const appliesTheTimeoutMsOptionAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup3());
  const timedOut = yield* Effect.promise(() =>
    runCodemode(harness, '// @options: {"timeout_ms": 200}\nwhile (true) {}'),
  );
  expect(timedOut.isError).toBe(true);
  expect(resultText(timedOut)).toContain("Script error:\nScript timed out");

  const invalid = yield* Effect.promise(() =>
    runCodemode(harness, '// @options: {"yield": 1}\ntext(1)'),
  );
  expect(invalid.isError).toBe(true);
  expect(invalid.content).toEqual([
    {
      text: "@options only supports `max_output_tokens` and `timeout_ms`; got `yield`",
      type: "text",
    },
  ]);

  const misplaced = yield* Effect.promise(() =>
    runCodemode(harness, '// count\n// @options: {"timeout_ms": 200}\nwhile (true) {}'),
  );
  expect(misplaced.isError).toBe(true);
  expect(misplaced.content).toEqual([
    {
      text: "The // @options: line must be the first line of the input; found one on line 2",
      type: "text",
    },
  ]);
});

const limitsScriptMemorySoRunawayAllocations = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup3());
  const result = yield* Effect.promise(() =>
    runCodemode(
      harness,
      '// @options: {"timeout_ms": 30000}\nlet a = [];\ntry { while (true) a.push("x".repeat(1 << 20) + a.length); } catch (error) { const n = a.length; a = null; return { n, error: String(error) }; }',
    ),
  );
  expect(result.isError).toBe(false);
  const { n, error } = (yield* fromJsonText(resultText(result))) as { n: number; error: string };
  expect(error).toContain("out of memory");

  expect(n).toBeLessThan(512);
});

const truncatesOutputToTheTokenBudget = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup3());
  const result = yield* Effect.promise(() =>
    runCodemode(
      harness,
      `// @options: {"max_output_tokens": 30}\nfor (let i = 0; i < 100; i++) text("row " + i);\nimage("data:image/png;base64,${TINY_PNG_BASE64}");`,
    ),
  );
  const details = result.details as unknown as codingAgentTypes.CodemodeToolDetails;
  const path = details.fullOutputPath;
  if (path === undefined || path === "") throw new Error("No spill file");
  try {
    const text = resultText(result);
    expect(text).toMatch(/^Warning: truncated output/u);
    expect(text).toContain("row 0\n");
    expect(text).toContain("tokens truncated");
    expect(text).toContain("row 99\n");
    expect(text).not.toContain("row 50\n");
    expect(text).toContain(`[Full output: ${path} (read with offset/limit)]`);

    expect(result.content.at(-1)).toEqual({
      data: TINY_PNG_BASE64,
      mimeType: "image/png",
      type: "image",
    });
    expect(yield* checkSavedImages(text.split("\n").at(-2) ?? "")).toBe("<saved>");
    expect(yield* readTextFile(path)).toBe(
      Array.from({ length: 100 }, (_, i) => `==> text ${i + 1}/100 <==\nrow ${i}`).join("\n"),
    );
  } finally {
    yield* removePath(path);
  }

  const small = yield* Effect.promise(() => runCodemode(harness, "return { ok: true };"));
  expect(
    (small.details as unknown as codingAgentTypes.CodemodeToolDetails).fullOutputPath,
  ).toBeUndefined();
});

const formatsOutputAtTheItemLimit = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup3());
  const startedAt = process.cpuUsage();
  const result = yield* Effect.promise(() =>
    runCodemode(harness, 'for (let i = 0; i < 100000; i++) text("");'),
  );
  const used = process.cpuUsage(startedAt);
  const cpuMillis = (used.user + used.system) / 1000;
  yield* removePath(
    (result.details as unknown as codingAgentTypes.CodemodeToolDetails).fullOutputPath ?? "",
  );
  expect(result.isError).toBe(false);
  expect(resultText(result)).toContain("==> text 100000/100000 <==");
  expect(cpuMillis).toBeLessThan(5000);
});

const resolvesBashCallsToStructuredResults = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [createCodemodeExtension()],
      initialActiveToolNames: ["codemode", "bash"],
    }),
  );
  harnesses3.push(harness);
  const result = yield* Effect.promise(() =>
    runCodemode(
      harness,
      'const r = await tools.bash({ command: "echo out; exit 3" });\ntext(JSON.stringify([r.output, r.exit_code, typeof r.wall_time_seconds]));',
    ),
  );
  expect(result.isError).toBe(false);
  expect(resultText(result)).toBe('["out\\n",3,"number"]');
});

const resolvesReadCallsToTextFor = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [createCodemodeExtension()],
      initialActiveToolNames: ["codemode", "read"],
    }),
  );
  harnesses3.push(harness);
  yield* writeTextFile(joinPath(harness.tempDir, "notes.txt"), "hello");
  yield* writeBytesFile(
    joinPath(harness.tempDir, "pixel.png"),
    Buffer.from(TINY_PNG_BASE64, "base64"),
  );
  const result = yield* Effect.promise(() =>
    runCodemode(
      harness,
      'text(await tools.read({ path: "notes.txt" }));\nconst shot = await tools.read({ path: "pixel.png" });\ntext(shot.note);\nimage(shot);',
    ),
  );
  expect(result.isError).toBe(false);
  expect(yield* checkSavedImages(resultText(result))).toBe(
    "==> text 1/2 <==\nhello\n==> text 2/2 <==\nRead image file [image/png]\n<saved>\n<image>",
  );
  expect(result.content.at(-1)).toEqual({
    data: TINY_PNG_BASE64,
    mimeType: "image/png",
    type: "image",
  });
});

const persistsStoreWritesAsCustomEntries = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup3());
  expect(resultText(yield* Effect.promise(() => runCodemode(harness, increment)))).toBe("1");
  expect(resultText(yield* Effect.promise(() => runCodemode(harness, increment)))).toBe("2");
  expect(storeEntries(harness)).toEqual([
    { delete: [], set: { count: 1 } },
    { delete: [], set: { count: 2 } },
  ]);
  const appended = harness
    .eventsOfType("entry_appended")
    .filter(
      (event) =>
        event.entry.type === "custom" && event.entry.customType === CODEMODE_STORE_ENTRY_TYPE,
    );
  expect(appended).toHaveLength(2);

  expect(
    resultText(
      yield* Effect.promise(() =>
        runCodemode(harness, 'store("count", undefined);\nreturn load("count") === undefined;'),
      ),
    ),
  ).toBe("true");
  expect(storeEntries(harness).at(-1)).toEqual({ delete: ["count"], set: {} });
});

const appendsNothingForFailedScriptsOr = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup3());
  expect(
    (yield* Effect.promise(() =>
      runCodemode(harness, 'store("count", 5);\nthrow new Error("boom");'),
    )).isError,
  ).toBe(true);
  expect(
    (yield* Effect.promise(() => runCodemode(harness, 'return load("count") ?? "missing";')))
      .isError,
  ).toBe(false);
  expect(storeEntries(harness)).toEqual([]);
});

const appliesTheTimeoutMsOptionAndRejects = () => Effect.runPromise(appliesTheTimeoutMsOptionAnd);

const limitsScriptMemorySoRunawayAllocationsFail = () =>
  Effect.runPromise(limitsScriptMemorySoRunawayAllocations);

const truncatesOutputToTheTokenBudgetAnd = () => Effect.runPromise(truncatesOutputToTheTokenBudget);

const formatsOutputAtTheItemLimitIn = () => Effect.runPromise(formatsOutputAtTheItemLimit);

const resolvesBashCallsToStructuredResultsAlso = () =>
  Effect.runPromise(resolvesBashCallsToStructuredResults);

const resolvesReadCallsToTextForText = () => Effect.runPromise(resolvesReadCallsToTextFor);

const persistsStoreWritesAsCustomEntriesFor = () =>
  Effect.runPromise(persistsStoreWritesAsCustomEntries);

const appendsNothingForFailedScriptsOrScripts = () =>
  Effect.runPromise(appendsNothingForFailedScriptsOr);

describe("codemode options and store", () => {
  afterEach(() => cleanupAll(harnesses3));

  it(
    "applies the timeout_ms option and rejects invalid options",
    appliesTheTimeoutMsOptionAndRejects,
  );

  it(
    "limits script memory so runaway allocations fail inside the script",
    limitsScriptMemorySoRunawayAllocationsFail,
  );

  it(
    "truncates output to the token budget and spills the full text",
    truncatesOutputToTheTokenBudgetAnd,
  );

  it("formats output at the item limit in linear time", formatsOutputAtTheItemLimitIn);

  it(
    "resolves bash calls to structured results, also for non-zero exit codes",
    resolvesBashCallsToStructuredResultsAlso,
  );

  it(
    "resolves read calls to text for text files and to image blocks that image() shows",
    resolvesReadCallsToTextForText,
  );

  it(
    "persists store() writes as custom entries for later calls",
    persistsStoreWritesAsCustomEntriesFor,
  );

  it(
    "appends nothing for failed scripts or scripts without writes",
    appendsNothingForFailedScriptsOrScripts,
  );
});
