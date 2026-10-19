import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { pendingHandoffs, takeHandoff } from "../src/core/orchestrator/handoff-files.ts";
import { createOrchestratorToolDefinitions } from "../src/core/orchestrator/tools.ts";
import { harness } from "./orchestrator-harness.ts";

const { setup, waitFor } = harness;

const directories: string[] = [];

function directory(): string {
  const created = mkdtempSync(join(tmpdir(), "msa-handoff-"));
  directories.push(created);
  return created;
}

afterEach(() => {
  for (const created of directories.splice(0)) rmSync(created, { recursive: true, force: true });
});

const sections = {
  premise: "Use claude-sonnet-5-5 for the implementation tasks.",
  goals: "1. rename Session to Thread\n2. add tell_orchestrator after it",
  donts: "Do not start the daemon work before the user confirms.",
};

describe("the file /handoff writes", () => {
  it("fills in the tasks, waiting and running lists, notes, and replans, and holds the model's three sections", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const handoffDirectory = directory();
        const { orchestrator, workers } = setup({ handoffDirectory });
        const cache = yield* Effect.promise(() =>
          orchestrator.createTask({
            title: "cache reads",
            currentState: "src/cache.ts has no cache",
            goalState: "repeated reads hit the cache",
            model: "fast/flash",
          }),
        );
        const docs = yield* Effect.promise(() =>
          orchestrator.createTask({
            title: "document the cache",
            currentState: "docs do not mention the cache",
            goalState: "docs describe the cache",
            dependsOn: [cache.id],
          }),
        );
        yield* Effect.promise(() =>
          orchestrator.sendNote({ content: "src/legacy.ts is going away", audience: "all" }),
        );
        yield* Effect.promise(() =>
          orchestrator.replan({
            reason: "the cache moved to its own module",
            stop: false,
            tasks: [
              {
                title: "move the cache",
                currentState: "cache is in a.ts",
                goalState: "cache is in cache.ts",
              },
            ],
          }),
        );
        workers[0]?.complete("Added the cache in src/cache.ts and a test for the second read.");
        yield* waitFor(
          () =>
            orchestrator.snapshot.tasks.find((task) => task.id === cache.id)?.reports.length === 1,
        );

        const result = yield* Effect.promise(() => orchestrator.handoff(sections));

        const text = readFileSync(result.path, "utf8");
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
    ));

  it("lists what waits and what runs, and leaves running sessions running", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { orchestrator, workers } = setup({ handoffDirectory: directory() });
        const first = yield* Effect.promise(() =>
          orchestrator.createTask({ title: "first", currentState: "a", goalState: "b" }),
        );
        const second = yield* Effect.promise(() =>
          orchestrator.createTask({
            title: "second",
            currentState: "c",
            goalState: "d",
            dependsOn: [first.id],
          }),
        );

        const review = orchestrator.snapshot.tasks.find((task) => task.kind === "review");

        const result = yield* Effect.promise(() => orchestrator.handoff(sections));

        const text = readFileSync(result.path, "utf8");
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
    ));

  it("says nothing about stopping when no session runs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { orchestrator } = setup({ handoffDirectory: directory() });

        const result = yield* Effect.promise(() => orchestrator.handoff(sections));

        expect(result.running).toBe(0);
        expect(result.notice).toBeUndefined();
        expect(readFileSync(result.path, "utf8")).toContain("## 実行中\n\nなし");
      }),
    ));

  it("takes the repository and branch from git", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const repository = directory();
        const git = (...args: string[]) => execFileSync("git", args, { cwd: repository });
        git("init", "-q", "-b", "feat/resume");
        git("remote", "add", "origin", "https://example.invalid/owner/project.git");
        git(
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@example.invalid",
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "init",
        );
        const { orchestrator } = setup({ handoffDirectory: directory(), cwd: repository });

        const result = yield* Effect.promise(() => orchestrator.handoff(sections));

        const text = readFileSync(result.path, "utf8");
        expect(text).toContain("- リポジトリ: owner/project");
        expect(text).toContain("- 枝: feat/resume");
      }),
    ));

  it("refuses a handoff without one of the three sections", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const handoffDirectory = directory();
        const { orchestrator } = setup({ handoffDirectory });

        const rejected = yield* Effect.promise(() =>
          orchestrator.handoff({ ...sections, donts: "  " }).then(
            () => undefined,
            (error: unknown) => error,
          ),
        );

        expect(String(rejected)).toContain("A handoff needs donts");
        expect(yield* Effect.promise(() => pendingHandoffs(handoffDirectory))).toEqual([]);
      }),
    ));
});

describe("where the file goes", () => {
  it("writes to <handoff directory>/<timestamp>-<short id>.md by default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const handoffDirectory = directory();
        const { orchestrator } = setup({ handoffDirectory });

        const result = yield* Effect.promise(() => orchestrator.handoff(sections));

        expect(result.path.startsWith(`${handoffDirectory}/`)).toBe(true);
        expect(result.path.slice(handoffDirectory.length + 1)).toMatch(
          /^\d{8}T\d{6}Z-[0-9a-f]{6}\.md$/u,
        );
      }),
    ));

  it("writes to the path given, creating its directories", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const target = join(directory(), "nested", "next.md");
        const { orchestrator } = setup({ handoffDirectory: directory() });

        const result = yield* Effect.promise(() =>
          orchestrator.handoff({ ...sections, path: target }),
        );

        expect(result.path).toBe(target);
        expect(readFileSync(target, "utf8")).toContain(sections.premise);
      }),
    ));

  it("puts a generated name inside a directory given as the path", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const target = directory();
        const { orchestrator } = setup({ handoffDirectory: directory() });

        const result = yield* Effect.promise(() =>
          orchestrator.handoff({ ...sections, path: target }),
        );

        expect(result.path.startsWith(`${target}/`)).toBe(true);
        expect(existsSync(result.path)).toBe(true);
      }),
    ));
});

describe("the handoff tool", () => {
  it("returns the line to paste, and the running notice only while sessions run", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const handoffDirectory = directory();
        const { orchestrator } = setup({ handoffDirectory });
        const handoffTool = createOrchestratorToolDefinitions(orchestrator).handoff;
        yield* Effect.promise(() =>
          orchestrator.createTask({ title: "first", currentState: "a", goalState: "b" }),
        );

        const output = yield* Effect.promise(() =>
          handoffTool.execute("call", sections, undefined, undefined, undefined as never),
        );

        const [pending] = yield* Effect.promise(() => pendingHandoffs(handoffDirectory));
        expect(output.content).toEqual([
          {
            type: "text",
            text: `${pending?.path} を読んで再開して\n実行中 1 本。止めるなら stop_task`,
          },
        ]);
      }),
    ));
});

describe("handoffs nobody has taken yet", () => {
  async function twoHandoffs() {
    const handoffDirectory = directory();
    const { orchestrator } = setup({ handoffDirectory });
    await orchestrator.createTask({ title: "first", currentState: "a", goalState: "b" });
    const older = await orchestrator.handoff(sections);
    await Effect.runPromise(Effect.sleep(5));
    await orchestrator.createTask({ title: "second", currentState: "c", goalState: "d" });
    const newer = await orchestrator.handoff(sections);
    return { handoffDirectory, older, newer };
  }

  it("lists them newest first with their task counts", () =>
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
    ));

  it("hands the first turn the file's text, records the file as taken, and does not move it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { handoffDirectory, older, newer } = yield* Effect.promise(twoHandoffs);
        const [first] = yield* Effect.promise(() => pendingHandoffs(handoffDirectory));

        const prompt = yield* Effect.promise(() =>
          takeHandoff(handoffDirectory, first?.name ?? ""),
        );

        expect(prompt).toContain(`${newer.path} を読んで再開する`);
        expect(prompt).toContain(readFileSync(newer.path, "utf8"));
        expect(existsSync(newer.path)).toBe(true);
        expect(readFileSync(join(handoffDirectory, "consumed.json"), "utf8")).toContain(
          first?.name ?? "",
        );
        const remaining = yield* Effect.promise(() => pendingHandoffs(handoffDirectory));
        expect(remaining.map((handoff) => handoff.path)).toEqual([older.path]);
      }),
    ));

  it("ignores files that are not handoffs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const handoffDirectory = directory();
        mkdirSync(handoffDirectory, { recursive: true });
        writeFileSync(join(handoffDirectory, "notes.md"), "# written by hand\n");
        writeFileSync(join(handoffDirectory, "consumed.json"), "not json");

        const pending = yield* Effect.promise(() => pendingHandoffs(handoffDirectory));

        expect(pending).toEqual([]);
      }),
    ));

  it("finds nothing when the directory does not exist", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const pending = yield* Effect.promise(() => pendingHandoffs(join(directory(), "missing")));

        expect(pending).toEqual([]);
      }),
    ));
});
