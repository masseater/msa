import { readdir } from "node:fs/promises";

import type { Context } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { codemodeChat } from "./codemode-chat-support.ts";
import {
  DONE,
  script,
  sqlitePath,
  directories,
  removeDirectories,
  openStoredChat,
  envDirectory,
  resultDetails,
} from "./codemode-support.ts";
import { awaited } from "./effect-support.ts";
import { dirnameOf } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(removeDirectories);

const writesResultFiles = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = codemodeChat();
  chat.holds.block = false;
  const cwd = yield* envDirectory();
  const written = deferred<string>();
  class CrashAfterWrite extends NodeExecutionEnv {
    override writeFile(path: string, content: string | Uint8Array, callContext: Context) {
      const superWriteFile = super.writeFile.bind(this);
      return runPromise(
        Effect.gen(function* () {
          yield* awaited(superWriteFile(path, content, callContext));
          written.resolve(path);
          return yield* awaited(aborted(callContext.abortSignal!));
        }),
      );
    }
  }
  const storage = yield* sqlitePath();
  chat.setup.faux.setResponses([
    script(`// @options: {"max_output_tokens": 20}\nreturn "x".repeat(1000);`),
    DONE,
  ]);
  let opened = yield* openStoredChat(storage, chat.setup, {
    env: new CrashAfterWrite({ cwd }),
  });
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  const first = yield* awaited(written.promise);
  yield* awaited(opened.harness.close(context));
  opened = yield* openStoredChat(storage, chat.setup, {
    env: new NodeExecutionEnv({ cwd }),
  });
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  const details = yield* resultDetails(opened.root);
  expect(details?.fullOutputPath).toBe(first);
  directories.add(dirnameOf(first));
  expect(yield* awaited(readdir(dirnameOf(first)))).toEqual(["output.txt"]);
  yield* awaited(opened.harness.close(context));
});

describe("durable code mode output and tool search", () => {
  it("writes the result's files to the same paths when it reruns after a crash", () =>
    Effect.runPromise(writesResultFiles));
});
