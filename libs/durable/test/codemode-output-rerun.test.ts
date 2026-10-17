import { readdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { Context } from "@msa/chord";
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
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(removeDirectories);

describe("durable code mode output and tool search", () => {
  it("writes the result's files to the same paths when it reruns after a crash", async () => {
    const chat = codemodeChat();
    chat.holds.block = false;
    const cwd = await envDirectory();
    const written = deferred<string>();
    // The process dies after the full output was written and before the result was committed.
    class CrashAfterWrite extends NodeExecutionEnv {
      override async writeFile(path: string, content: string | Uint8Array, callContext: Context) {
        const result = await super.writeFile(path, content, callContext);
        written.resolve(path);
        await aborted(callContext.abortSignal!);
        return result;
      }
    }
    const storage = await sqlitePath();
    chat.setup.faux.setResponses([
      script(`// @options: {"max_output_tokens": 20}\nreturn "x".repeat(1000);`),
      DONE,
    ]);
    let opened = await openStoredChat(storage, chat.setup, {
      env: new CrashAfterWrite({ cwd }),
    });
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    const first = await written.promise;
    await opened.harness.close(context);
    opened = await openStoredChat(storage, chat.setup, {
      env: new NodeExecutionEnv({ cwd }),
    });
    opened.harness.resume();
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    const details = await resultDetails(opened.root);
    expect(details?.fullOutputPath).toBe(first);
    directories.add(dirname(first));
    expect(await readdir(dirname(first))).toEqual(["output.txt"]);
    await opened.harness.close(context);
  });
});
