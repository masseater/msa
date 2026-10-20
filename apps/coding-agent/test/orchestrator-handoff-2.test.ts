import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { pendingHandoffs, takeHandoff } from "../src/core/orchestrator/handoff-files.ts";
import { createOrchestratorToolDefinitions } from "../src/core/orchestrator/tools.ts";
import orchestratorHandoffSupport from "./orchestrator-handoff-support.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  readTextFile,
  removeDirs,
  runTest,
  writeTextFile,
} = testing;

const { sections } = orchestratorHandoffSupport;

const { harness } = orchestratorHarness;

const { setup } = harness;

const directories: string[] = [];

const directory = Effect.fn("directory")(function* () {
  const created = yield* makeTempDir("msa-handoff-");
  directories.push(created);
  return created;
});

afterEach(() => runTest(removeDirs(directories.splice(0))));

const writesToHandoffDirectoryTimestampShortId = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const handoffDirectory = yield* directory();
      const { orchestrator } = setup({ handoffDirectory });

      const result = yield* Effect.promise(() => orchestrator.handoff(sections));

      expect(result.path.startsWith(`${handoffDirectory}/`)).toBe(true);
      expect(result.path.slice(handoffDirectory.length + 1)).toMatch(
        /^\d{8}T\d{6}Z-[0-9a-f]{6}\.md$/u,
      );
    }),
  );

const putsAGeneratedNameInsideADirectory = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const target = yield* directory();
      const { orchestrator } = setup({ handoffDirectory: yield* directory() });

      const result = yield* Effect.promise(() =>
        orchestrator.handoff({ ...sections, path: target }),
      );

      expect(result.path.startsWith(`${target}/`)).toBe(true);
      expect(yield* pathExists(result.path)).toBe(true);
    }),
  );

const writesToThePathGivenCreatingIts = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const target = joinPath(yield* directory(), "nested", "next.md");
      const { orchestrator } = setup({ handoffDirectory: yield* directory() });

      const result = yield* Effect.promise(() =>
        orchestrator.handoff({ ...sections, path: target }),
      );

      expect(result.path).toBe(target);
      expect(yield* readTextFile(target)).toContain(sections.premise);
    }),
  );

describe("where the file goes", () => {
  it(
    "writes to <handoff directory>/<timestamp>-<short id>.md by default",
    writesToHandoffDirectoryTimestampShortId,
  );

  it("writes to the path given, creating its directories", writesToThePathGivenCreatingIts);

  it(
    "puts a generated name inside a directory given as the path",
    putsAGeneratedNameInsideADirectory,
  );
});

const returnsTheLineToPasteAndThe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const handoffDirectory = yield* directory();
      const { orchestrator } = setup({ handoffDirectory });
      const handoffTool = createOrchestratorToolDefinitions(orchestrator).handoff;
      yield* Effect.promise(() =>
        orchestrator.createTask({ currentState: "a", goalState: "b", title: "first" }),
      );

      const output = yield* Effect.promise(() =>
        handoffTool.execute("call", sections, undefined, undefined, undefined as never),
      );

      const [pending] = yield* Effect.promise(() => pendingHandoffs(handoffDirectory));
      expect(output.content).toEqual([
        {
          text: `${pending?.path} を読んで再開して\n実行中 1 本。止めるなら stop_task`,
          type: "text",
        },
      ]);
    }),
  );

describe("the handoff tool", () => {
  it(
    "returns the line to paste, and the running notice only while threads run",
    returnsTheLineToPasteAndThe,
  );
});

function twoHandoffs() {
  return runTest(
    Effect.gen(function* () {
      const handoffDirectory = yield* directory();
      const { orchestrator } = setup({ handoffDirectory });
      yield* awaited(
        orchestrator.createTask({ currentState: "a", goalState: "b", title: "first" }),
      );
      const older = yield* awaited(orchestrator.handoff(sections));
      yield* Effect.sleep(5);
      yield* awaited(
        orchestrator.createTask({ currentState: "c", goalState: "d", title: "second" }),
      );
      const newer = yield* awaited(orchestrator.handoff(sections));
      return { handoffDirectory, newer, older };
    }),
  );
}

const listsThemNewestFirstWithTheirTask = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { handoffDirectory, older, newer } = yield* Effect.promise(twoHandoffs);

      const pending = yield* Effect.promise(() => pendingHandoffs(handoffDirectory));

      expect(pending.map((handoff) => [handoff.path, handoff.tasks])).toEqual([
        [newer.path, newer.tasks],
        [older.path, older.tasks],
      ]);
      expect(newer.tasks).toBeGreaterThan(older.tasks);
    }),
  );

const handsTheFirstTurnTheFileS = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { handoffDirectory, older, newer } = yield* Effect.promise(twoHandoffs);
      const [first] = yield* Effect.promise(() => pendingHandoffs(handoffDirectory));

      const prompt = yield* Effect.promise(() => takeHandoff(handoffDirectory, first?.name ?? ""));

      expect(prompt).toContain(`${newer.path} を読んで再開する`);
      expect(prompt).toContain(yield* readTextFile(newer.path));
      expect(yield* pathExists(newer.path)).toBe(true);
      expect(yield* readTextFile(joinPath(handoffDirectory, "consumed.json"))).toContain(
        first?.name ?? "",
      );
      const remaining = yield* Effect.promise(() => pendingHandoffs(handoffDirectory));
      expect(remaining.map((handoff) => handoff.path)).toEqual([older.path]);
    }),
  );

const ignoresFilesThatAreNotHandoffs = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const handoffDirectory = yield* directory();
      yield* makeDirectory(handoffDirectory);
      yield* writeTextFile(joinPath(handoffDirectory, "notes.md"), "# written by hand\n");
      yield* writeTextFile(joinPath(handoffDirectory, "consumed.json"), "not json");

      const pending = yield* Effect.promise(() => pendingHandoffs(handoffDirectory));

      expect(pending).toEqual([]);
    }),
  );

const findsNothingWhenTheDirectoryDoesNot = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const missing = joinPath(yield* directory(), "missing");
      const pending = yield* awaited(pendingHandoffs(missing));

      expect(pending).toEqual([]);
    }),
  );

describe("handoffs nobody has taken yet", () => {
  it("lists them newest first with their task counts", listsThemNewestFirstWithTheirTask);

  it(
    "hands the first turn the file's text, records the file as taken, and does not move it",
    handsTheFirstTurnTheFileS,
  );

  it("ignores files that are not handoffs", ignoresFilesThatAreNotHandoffs);

  it("finds nothing when the directory does not exist", findsNothingWhenTheDirectoryDoesNot);
});
