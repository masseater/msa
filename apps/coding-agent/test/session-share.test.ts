import { EventEmitter } from "node:events";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

vi.mock("node:child_process", (importOriginal) =>
  importOriginal<Record<string, unknown>>().then((actual) => ({ ...actual, ...childProcessMocks })),
);

import testing from "@msa/testing";
import { Effect } from "effect";

import sessionShare from "../src/modes/interactive/session-share.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";

const { shareSession } = sessionShare;
const { initTheme } = themeModule;

const { awaited, gate, provideNode, readTextFile, runTest, writeTextFile } = testing;

const fakeGh = (uploads: string[]) => (_command: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
  });
  Effect.runFork(
    provideNode(
      Effect.gen(function* () {
        uploads.push(yield* readTextFile(args.at(-1) ?? ""));
        child.stdout.emit("data", `https://gist.github.com/test/${uploads.length}\n`);
        child.emit("close", 0);
      }),
    ),
  );
  return child;
};

const shareContext = (
  name: "A" | "B",
  exportToHtml: (filePath: string) => Promise<void>,
  errors: string[],
) => ({
  editorSlot: { restoreEditor() {}, show() {} },
  session: {
    context: { exports: { exportToHtml } },
    sessionManager: { getBranch: () => [], getCwd: () => "/tmp", getSessionId: () => name },
    state: { systemPrompt: name, tools: [] },
  },
  showError(message: string) {
    errors.push(message);
  },
  showStatus() {},
  ui: { requestRender() {}, setFocus() {} },
});

const keepsConcurrentExportsIsolated = Effect.gen(function* () {
  const uploads: string[] = [];
  childProcessMocks.spawn.mockImplementation(fakeGh(uploads));
  const aWritten = gate();
  const bWritten = gate();
  const releaseB = gate();
  const errors: string[] = [];
  const exportAs = (name: "A" | "B") => (filePath: string) =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(filePath, name);
        (name === "A" ? aWritten : bWritten).release();
        yield* awaited(name === "A" ? bWritten : releaseB);
      }),
    );
  const shareA = shareSession(shareContext("A", exportAs("A"), errors) as never);
  yield* awaited(aWritten);
  const shareB = shareSession(shareContext("B", exportAs("B"), errors) as never);
  yield* awaited(bWritten);
  yield* awaited(shareA);
  releaseB.release();
  yield* awaited(shareB);
  expect(uploads).toEqual(["A", "B"]);
  expect(errors).toEqual([]);
});

describe("shareSession", () => {
  beforeAll(() => initTheme("dark"));
  beforeEach(() => vi.clearAllMocks());

  it("keeps concurrent session exports isolated", () => runTest(keepsConcurrentExportsIsolated));
});
