import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

vi.mock("node:child_process", () => childProcessMocks);

import { awaited, runTest, writeTextFile } from "@msa/testing";
import { Effect } from "effect";

import { shareSession } from "../src/modes/interactive/session-share.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("shareSession", () => {
  beforeAll(() => initTheme("dark"));
  beforeEach(() => vi.clearAllMocks());

  it("keeps concurrent session exports isolated", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const uploads: string[] = [];
        childProcessMocks.spawn.mockImplementation((_command, args: string[]) => {
          uploads.push(readFileSync(args.at(-1)!, "utf8"));
          const child = Object.assign(new EventEmitter(), {
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            kill: vi.fn(),
          });
          queueMicrotask(() => {
            child.stdout.end(`https://gist.github.com/test/${uploads.length}\n`);
            child.stderr.end();
            child.emit("close", 0);
          });
          return child;
        });

        const aWritten = deferred();
        const bWritten = deferred();
        const releaseB = deferred();
        const errors: string[] = [];
        const context = (name: "A" | "B") => ({
          session: {
            sessionManager: {
              getSessionId: () => name,
              getCwd: () => "/tmp",
              getBranch: () => [],
            },
            state: { systemPrompt: name, tools: [] },
            exportToHtml: (filePath: string) =>
              effectRunPromise(
                Effect.gen(function* () {
                  yield* writeTextFile(filePath, name);
                  if (name === "A") {
                    aWritten.resolve();
                    yield* awaited(bWritten.promise);
                  } else {
                    bWritten.resolve();
                    yield* awaited(releaseB.promise);
                  }
                }),
              ),
          },
          ui: { setFocus() {}, requestRender() {} },
          editorSlot: { show() {}, restoreEditor() {} },
          showStatus() {},
          showError(message: string) {
            errors.push(message);
          },
        });

        const shareA = shareSession(context("A") as never);
        yield* awaited(aWritten.promise);
        const shareB = shareSession(context("B") as never);
        yield* awaited(bWritten.promise);
        yield* awaited(shareA);
        releaseB.resolve();
        yield* awaited(shareB);

        expect(uploads).toEqual(["A", "B"]);
        expect(errors).toEqual([]);
      }),
    ));
});
