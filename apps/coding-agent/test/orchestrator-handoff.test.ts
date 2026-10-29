import testing from "@msa/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { afterEach, describe, expect, it } from "vite-plus/test";

import handoffFiles from "../src/core/orchestrator/handoff-files.ts";
import orchestratorHandoffSupport from "./orchestrator-handoff-support.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const { pendingHandoffs } = handoffFiles;

const { sections } = orchestratorHandoffSupport;

const { harness } = orchestratorHarness;

const { disposeRunning, setup, waitFor } = harness;

const { awaited, makeTempDir, provideNode, readTextFile, removeDirs, runTest } = testing;

const directories: string[] = [];

const directory = Effect.fn("directory")(function* () {
  const created = yield* makeTempDir("msa-handoff-");
  directories.push(created);
  return created;
});

afterEach(() => runTest(Effect.andThen(disposeRunning(), removeDirs(directories.splice(0)))));

const git = (cwd: string, ...args: string[]) =>
  provideNode(
    Effect.scoped(
      Effect.flatMap(
        ChildProcess.make("git", args, {
          cwd,
          stderr: "ignore",
          stdin: "ignore",
          stdout: "ignore",
        }),
        (handle) => handle.exitCode,
      ),
    ),
  ).pipe(Effect.orDie);

const COMMIT = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q"];

const createRepository = Effect.fn("createRepository")(function* () {
  const repository = yield* directory();
  yield* git(repository, "init", "-q", "-b", "feat/resume");
  yield* git(repository, "remote", "add", "origin", "https://example.invalid/owner/project.git");
  yield* git(repository, ...COMMIT, "--allow-empty", "-m", "init");
  return repository;
});

const listsWhatWaitsAndWhatRunsAnd = () =>
  runTest(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ handoffDirectory: yield* directory() });
      const first = yield* awaited(
        orchestrator.createTask({ currentState: "a", goalState: "b", title: "first" }),
      );
      const second = yield* awaited(
        orchestrator.createTask({
          currentState: "c",
          dependsOn: [first.id],
          goalState: "d",
          title: "second",
        }),
      );

      const review = orchestrator.snapshot.tasks.find((task) => task.kind === "review");

      const result = yield* awaited(orchestrator.handoff(sections));

      const text = yield* readTextFile(result.path);
      expect(text).toContain(
        `## 待機中\n\n- ${review?.id} ${review?.title}: waiting for first, second\n- ${second.id} second: waiting for first`,
      );
      expect(text).toContain(
        `## 実行中\n\n実行中 1 本。止めるなら stop_task\n\n- ${first.id} first\n\n## 共有メモ`,
      );
      expect(result.running).toBe(1);
      expect(result.notice).toBe("実行中 1 本。止めるなら stop_task");
      expect(orchestrator.snapshot.tasks.find((task) => task.id === first.id)?.status).toBe(
        "running",
      );
      expect(workers[0]?.isStreaming).toBe(true);
    }),
  );

const saysNothingAboutStoppingWhenNoThread = () =>
  runTest(
    Effect.gen(function* () {
      const { orchestrator } = setup({ handoffDirectory: yield* directory() });

      const result = yield* awaited(orchestrator.handoff(sections));

      expect(result.running).toBe(0);
      expect(result.notice).toBeUndefined();
      expect(yield* readTextFile(result.path)).toContain("## 実行中\n\nなし");
    }),
  );

const takesTheRepositoryAndBranchFromGit = () =>
  runTest(
    Effect.gen(function* () {
      const repository = yield* createRepository();
      const { orchestrator } = setup({ cwd: repository, handoffDirectory: yield* directory() });

      const result = yield* awaited(orchestrator.handoff(sections));

      const text = yield* readTextFile(result.path);
      expect(text).toContain("- リポジトリ: owner/project");
      expect(text).toContain("- 枝: feat/resume");
    }),
  );

const refusesAHandoffWithoutOneOfThe = () =>
  runTest(
    Effect.gen(function* () {
      const handoffDirectory = yield* directory();
      const { orchestrator } = setup({ handoffDirectory });

      const rejected = yield* awaited(
        orchestrator.handoff({ ...sections, donts: "  " }).then(
          () => undefined,
          (error: unknown) => error,
        ),
      );

      expect(String(rejected)).toContain("A handoff needs donts");
      expect(yield* awaited(pendingHandoffs(handoffDirectory))).toEqual([]);
    }),
  );

const prepareHandoffState = Effect.fn("prepareHandoffState")(function* () {
  const handoffDirectory = yield* directory();
  const { orchestrator, workers } = setup({ handoffDirectory });
  const cache = yield* awaited(
    orchestrator.createTask({
      currentState: "src/cache.ts has no cache",
      goalState: "repeated reads hit the cache",
      model: "fast/flash",
      title: "cache reads",
    }),
  );
  const docs = yield* awaited(
    orchestrator.createTask({
      currentState: "docs do not mention the cache",
      dependsOn: [cache.id],
      goalState: "docs describe the cache",
      title: "document the cache",
    }),
  );
  yield* awaited(
    orchestrator.sendNote({ audience: "all", content: "src/legacy.ts is going away" }),
  );
  yield* awaited(
    orchestrator.replan({
      reason: "the cache moved to its own module",
      stop: false,
      tasks: [
        {
          currentState: "cache is in a.ts",
          goalState: "cache is in cache.ts",
          title: "move the cache",
        },
      ],
    }),
  );
  workers[0]?.complete("Added the cache in src/cache.ts and a test for the second read.");
  yield* waitFor(
    () => orchestrator.snapshot.tasks.find((task) => task.id === cache.id)?.reports.length === 1,
  );

  return { cache, docs, orchestrator };
});

const fillsInTheTasksWaitingAndRunning = () =>
  runTest(
    Effect.gen(function* () {
      const { cache, docs, orchestrator } = yield* prepareHandoffState();
      const result = yield* awaited(orchestrator.handoff(sections));

      const text = yield* readTextFile(result.path);
      expect(text.split("\n").slice(0, 2)).toEqual([
        "このファイルは msa の /handoff が書いた。",
        "読んだら、達成したい状態の順に create_task で依存を張って立て直す。",
      ]);
      expect(text).toContain("- msa: 0.0.0-test");
      expect(text).toContain("- 作業ディレクトリ: /repo");
      expect(text).toContain(`## 前提\n\n${sections.premise}`);
      expect(text).toContain(`## 達成したい状態（依存の順）\n\n${sections.goals}`);
      expect(text).toContain(`## 着手してはいけないもの\n\n${sections.donts}`);
      expect(text).toContain(`### ${cache.id} cache reads`);
      expect(text).toContain("- model: fast/flash");
      expect(text).toContain("> src/cache.ts has no cache");
      expect(text).toContain("> repeated reads hit the cache");
      expect(text).toContain("Added the cache in src/cache.ts and a test for the second read.");
      expect(text).toContain(`### ${docs.id} document the cache`);
      expect(text).toContain(`- 依存: ${cache.id}`);
      expect(text).toContain("> src/legacy.ts is going away");
      expect(text).toContain("the cache moved to its own module");
      expect(text).toContain("（gh が使えないため取得していない）");
      expect(result.tasks).toBe(orchestrator.snapshot.tasks.length);
      expect(result.line).toBe(`${result.path} を読んで再開して`);
    }),
  );

describe("the file /handoff writes", () => {
  it(
    "fills in the tasks, waiting and running lists, notes, and replans, and holds the model's three sections",
    fillsInTheTasksWaitingAndRunning,
  );

  it(
    "lists what waits and what runs, and leaves running threads running",
    listsWhatWaitsAndWhatRunsAnd,
  );

  it("says nothing about stopping when no thread runs", saysNothingAboutStoppingWhenNoThread);

  it("takes the repository and branch from git", takesTheRepositoryAndBranchFromGit);

  it("refuses a handoff without one of the three sections", refusesAHandoffWithoutOneOfThe);
});
