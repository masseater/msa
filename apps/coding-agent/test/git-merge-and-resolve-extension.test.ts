import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { awaited, runTest, writeTextFile, makeDirectory, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import mergeAndResolve from "../examples/extensions/git-merge-and-resolve.ts";
import type { ExecResult, ExtensionAPI, ExtensionContext } from "../src/core/extensions/index.ts";

type AgentEndHandler = (event: { type: "agent_end" }, ctx: ExtensionContext) => Promise<undefined>;

const ok: ExecResult = { stdout: "", stderr: "", code: 0, killed: false };
const fail: ExecResult = { stdout: "", stderr: "error", code: 1, killed: false };

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
    on: (event: string, h: AgentEndHandler) => {
      if (event === "agent_end") handler = h;
    },
    exec,
    sendUserMessage,
  } as unknown as ExtensionAPI;

  mergeAndResolve(api);

  const ctx = { cwd, ui: { notify: vi.fn() } } as unknown as ExtensionContext;

  function trigger() {
    return runTest(
      Effect.gen(function* () {
        yield* awaited(handler!({ type: "agent_end" as const }, ctx));
      }),
    );
  }

  return { trigger, exec, sendUserMessage };
}

describe("git-merge-and-resolve example", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  });

  function createTempDir() {
    tempDir = mkdtempSync(joinPath(tmpdir(), "msa-merge-test-"));
    return tempDir;
  }

  it("skips when not a git repository", () =>
    runTest(
      Effect.gen(function* () {
        const cwd = createTempDir();
        const results = new Map<string, ExecResult>();
        results.set("git rev-parse --git-dir", fail);

        const { trigger, exec, sendUserMessage } = setup(cwd, results);
        yield* awaited(trigger());

        expect(exec).toHaveBeenCalledTimes(1);
        expect(sendUserMessage).not.toHaveBeenCalled();
      }),
    ));

  it("skips when no upstream is configured", () =>
    runTest(
      Effect.gen(function* () {
        const cwd = createTempDir();
        const results = new Map<string, ExecResult>();
        results.set("git rev-parse --git-dir", ok);
        results.set("git rev-parse --abbrev-ref --symbolic-full-name @{u}", fail);

        const { trigger, sendUserMessage } = setup(cwd, results);
        yield* awaited(trigger());

        expect(sendUserMessage).not.toHaveBeenCalled();
      }),
    ));

  it("re-sends conflicts when in an unfinished merge", () =>
    runTest(
      Effect.gen(function* () {
        const cwd = createTempDir();
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
    ));

  it("skips when working tree is dirty and not in a merge", () =>
    runTest(
      Effect.gen(function* () {
        const cwd = createTempDir();
        const results = new Map<string, ExecResult>();
        results.set("git rev-parse --git-dir", ok);
        results.set("git rev-parse MERGE_HEAD", fail);
        results.set("git status --porcelain", { ...ok, stdout: " M src/index.ts\n" });

        const { trigger, exec, sendUserMessage } = setup(cwd, results);
        yield* awaited(trigger());

        expect(exec).not.toHaveBeenCalledWith("git", ["fetch", "origin"]);
        expect(sendUserMessage).not.toHaveBeenCalled();
      }),
    ));

  it("skips when fetch fails", () =>
    runTest(
      Effect.gen(function* () {
        const cwd = createTempDir();
        const results = withUpstream(new Map<string, ExecResult>());
        results.set("git fetch origin", fail);

        const { trigger, sendUserMessage } = setup(cwd, results);
        yield* awaited(trigger());

        expect(sendUserMessage).not.toHaveBeenCalled();
      }),
    ));

  it("skips when merge is clean", () =>
    runTest(
      Effect.gen(function* () {
        const cwd = createTempDir();
        const results = withUpstream(new Map<string, ExecResult>());
        results.set("git merge --no-ff origin/main", ok);

        const { trigger, sendUserMessage } = setup(cwd, results);
        yield* awaited(trigger());

        expect(sendUserMessage).not.toHaveBeenCalled();
      }),
    ));

  it("sends conflict report as a follow-up", () =>
    runTest(
      Effect.gen(function* () {
        const cwd = createTempDir();
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
    ));

  it("handles empty ours or theirs sections", () =>
    runTest(
      Effect.gen(function* () {
        const cwd = createTempDir();
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
    ));

  it("skips message when merge fails but no conflict markers found", () =>
    runTest(
      Effect.gen(function* () {
        const cwd = createTempDir();
        const results = withUpstream(new Map<string, ExecResult>());
        results.set("git merge --no-ff origin/main", { ...fail, code: 1 });
        results.set("git diff --name-only --diff-filter=U", { ...ok, stdout: "" });

        const { trigger, sendUserMessage } = setup(cwd, results);
        yield* awaited(trigger());

        expect(sendUserMessage).not.toHaveBeenCalled();
      }),
    ));
});
