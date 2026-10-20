import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import mergeAndResolve from "../examples/extensions/git-merge-and-resolve.ts";
import type { ExecResult, ExtensionAPI, ExtensionContext } from "../src/core/extensions/index.ts";

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, runTest, writeTextFile } =
  testing;

type AgentEndHandler = (event: { type: "agent_end" }, ctx: ExtensionContext) => Promise<undefined>;

const ok: ExecResult = { code: 0, killed: false, stderr: "", stdout: "" };
const fail: ExecResult = { code: 1, killed: false, stderr: "error", stdout: "" };

function withUpstream(results: Map<string, ExecResult>): Map<string, ExecResult> {
  results.set("git rev-parse --git-dir", ok);
  results.set("git rev-parse MERGE_HEAD", fail);
  results.set("git status --porcelain", ok);
  results.set("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
    ...ok,
    stdout: "origin/main\n",
  });
  results.set("git fetch origin", ok);
  return results;
}

function setup(cwd: string, execResults: Map<string, ExecResult>) {
  let handler: AgentEndHandler | undefined;
  const sendUserMessage = vi.fn();

  const exec = vi.fn<ExtensionAPI["exec"]>().mockImplementation((cmd, args) =>
    runTest(
      Effect.gen(function* () {
        const key = [cmd, ...args].join(" ");
        return yield* awaited(execResults.get(key) ?? fail);
      }),
    ),
  );

  const api = {
    exec,
    on: (event: string, h: AgentEndHandler) => {
      if (event === "agent_end") handler = h;
    },
    sendUserMessage,
  } as unknown as ExtensionAPI;

  mergeAndResolve(api);

  const ctx = { cwd, ui: { notify: vi.fn() } } as unknown as ExtensionContext;

  function trigger() {
    return runTest(awaited(handler!({ type: "agent_end" as const }, ctx)));
  }

  return { exec, sendUserMessage, trigger };
}

let tempDir: string;

const createTempDir: Effect.Effect<string> = Effect.gen(function* () {
  tempDir = yield* makeTempDir("msa-merge-test-");
  return tempDir;
});

const skipsWhenNotAGitRepository = () =>
  runTest(
    Effect.gen(function* () {
      const cwd = yield* createTempDir;
      const results = new Map<string, ExecResult>();
      results.set("git rev-parse --git-dir", fail);

      const { trigger, exec, sendUserMessage } = setup(cwd, results);
      yield* awaited(trigger());

      expect(exec).toHaveBeenCalledTimes(1);
      expect(sendUserMessage).not.toHaveBeenCalled();
    }),
  );

const skipsWhenNoUpstreamIsConfigured = () =>
  runTest(
    Effect.gen(function* () {
      const cwd = yield* createTempDir;
      const results = new Map<string, ExecResult>();
      results.set("git rev-parse --git-dir", ok);
      results.set("git rev-parse --abbrev-ref --symbolic-full-name @{u}", fail);

      const { trigger, sendUserMessage } = setup(cwd, results);
      yield* awaited(trigger());

      expect(sendUserMessage).not.toHaveBeenCalled();
    }),
  );

const reSendsConflictsWhenInAnUnfinished = () =>
  runTest(
    Effect.gen(function* () {
      const cwd = yield* createTempDir;
      const conflictContent = [
        "<<<<<<< HEAD",
        "ours",
        "=======",
        "theirs",
        ">>>>>>> origin/main",
      ].join("\n");
      yield* writeTextFile(joinPath(cwd, "file.ts"), conflictContent);

      const results = new Map<string, ExecResult>();
      results.set("git rev-parse --git-dir", ok);
      results.set("git rev-parse MERGE_HEAD", ok);
      results.set("git diff --name-only --diff-filter=U", { ...ok, stdout: "file.ts\n" });

      const { trigger, exec, sendUserMessage } = setup(cwd, results);
      yield* awaited(trigger());

      expect(exec).not.toHaveBeenCalledWith("git", ["fetch", "origin"]);
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      const [call] = sendUserMessage.mock.calls;
      if (call === undefined) throw new Error("expected sendUserMessage to be called");
      const message = call[0] as string;
      expect(message).toContain("file.ts:1-5");
    }),
  );

const skipsWhenWorkingTreeIsDirtyAnd = () =>
  runTest(
    Effect.gen(function* () {
      const cwd = yield* createTempDir;
      const results = new Map<string, ExecResult>();
      results.set("git rev-parse --git-dir", ok);
      results.set("git rev-parse MERGE_HEAD", fail);
      results.set("git status --porcelain", { ...ok, stdout: " M src/index.ts\n" });

      const { trigger, exec, sendUserMessage } = setup(cwd, results);
      yield* awaited(trigger());

      expect(exec).not.toHaveBeenCalledWith("git", ["fetch", "origin"]);
      expect(sendUserMessage).not.toHaveBeenCalled();
    }),
  );

const skipsWhenFetchFails = () =>
  runTest(
    Effect.gen(function* () {
      const cwd = yield* createTempDir;
      const results = withUpstream(new Map<string, ExecResult>());
      results.set("git fetch origin", fail);

      const { trigger, sendUserMessage } = setup(cwd, results);
      yield* awaited(trigger());

      expect(sendUserMessage).not.toHaveBeenCalled();
    }),
  );

const skipsWhenMergeIsClean = () =>
  runTest(
    Effect.gen(function* () {
      const cwd = yield* createTempDir;
      const results = withUpstream(new Map<string, ExecResult>());
      results.set("git merge --no-ff origin/main", ok);

      const { trigger, sendUserMessage } = setup(cwd, results);
      yield* awaited(trigger());

      expect(sendUserMessage).not.toHaveBeenCalled();
    }),
  );

const sendsConflictReportAsAFollowUp = () =>
  runTest(
    Effect.gen(function* () {
      const cwd = yield* createTempDir;
      const conflictContent = [
        "line 1",
        "<<<<<<< HEAD",
        "our change",
        "=======",
        "their change",
        ">>>>>>> origin/main",
        "line 7",
        "<<<<<<< HEAD",
        "second conflict",
        "=======",
        "their second",
        ">>>>>>> origin/main",
      ].join("\n");

      yield* makeDirectory(joinPath(cwd, "src"));
      yield* writeTextFile(joinPath(cwd, "src/index.ts"), conflictContent);

      const results = withUpstream(new Map<string, ExecResult>());
      results.set("git merge --no-ff origin/main", { ...fail, code: 1 });
      results.set("git diff --name-only --diff-filter=U", { ...ok, stdout: "src/index.ts\n" });

      const { trigger, sendUserMessage } = setup(cwd, results);
      yield* awaited(trigger());

      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      const [call] = sendUserMessage.mock.calls;
      if (call === undefined) throw new Error("expected sendUserMessage to be called");
      const [message, options] = call;
      expect(message).toContain("src/index.ts:2-6 (ours 3, theirs 5)");
      expect(message).toContain("src/index.ts:8-12 (ours 9, theirs 11)");
      expect(options).toEqual({ deliverAs: "followUp" });
    }),
  );

const handlesEmptyOursOrTheirsSections = () =>
  runTest(
    Effect.gen(function* () {
      const cwd = yield* createTempDir;
      const conflictContent = [
        "<<<<<<< HEAD",
        "=======",
        "only theirs",
        ">>>>>>> origin/main",
      ].join("\n");

      yield* writeTextFile(joinPath(cwd, "empty-ours.ts"), conflictContent);

      const results = withUpstream(new Map<string, ExecResult>());
      results.set("git merge --no-ff origin/main", { ...fail, code: 1 });
      results.set("git diff --name-only --diff-filter=U", { ...ok, stdout: "empty-ours.ts\n" });

      const { trigger, sendUserMessage } = setup(cwd, results);
      yield* awaited(trigger());

      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      const [call] = sendUserMessage.mock.calls;
      if (call === undefined) throw new Error("expected sendUserMessage to be called");
      const message = call[0] as string;
      expect(message).toContain("empty-ours.ts:1-4 (ours empty, theirs 3)");
    }),
  );

const skipsMessageWhenMergeFailsButNo = () =>
  runTest(
    Effect.gen(function* () {
      const cwd = yield* createTempDir;
      const results = withUpstream(new Map<string, ExecResult>());
      results.set("git merge --no-ff origin/main", { ...fail, code: 1 });
      results.set("git diff --name-only --diff-filter=U", { ...ok, stdout: "" });

      const { trigger, sendUserMessage } = setup(cwd, results);
      yield* awaited(trigger());

      expect(sendUserMessage).not.toHaveBeenCalled();
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      if (tempDir.length > 0) yield* removePath(tempDir);
    }),
  );

describe("git-merge-and-resolve example", () => {
  afterEach(afterEachHook);

  it("skips when not a git repository", skipsWhenNotAGitRepository);

  it("skips when no upstream is configured", skipsWhenNoUpstreamIsConfigured);

  it("re-sends conflicts when in an unfinished merge", reSendsConflictsWhenInAnUnfinished);

  it("skips when working tree is dirty and not in a merge", skipsWhenWorkingTreeIsDirtyAnd);

  it("skips when fetch fails", skipsWhenFetchFails);

  it("skips when merge is clean", skipsWhenMergeIsClean);

  it("sends conflict report as a follow-up", sendsConflictReportAsAFollowUp);

  it("handles empty ours or theirs sections", handlesEmptyOursOrTheirsSections);

  it(
    "skips message when merge fails but no conflict markers found",
    skipsMessageWhenMergeFailsButNo,
  );
});
