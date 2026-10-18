import { defineExtension, ToolResultEntry } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { createBashTool, createEditTool, createReadTool } from "../src/tools/index.ts";
import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import { resultText, results, DONE, calls } from "./harness-tools-support.ts";
import { withTempDir, writeTempFile, readTempFile } from "./platform-support.ts";
import { context } from "./session-support.ts";

const answersFailingCommand = Effect.asVoid(
  Effect.suspend(() =>
    withTempDir("msa-durable-coding-", (directory) =>
      Effect.gen(function* () {
        const setup = chatSetup();
        addTool(setup.registry, createBashTool());
        const command = "i=1; while [ $i -le 3000 ]; do echo line-$i; i=$((i + 1)); done; exit 7";
        setup.faux.setResponses([calls(["bash", { command }, "b"]), DONE]);
        const env = new NodeExecutionEnv({ cwd: directory });
        const { harness, root } = yield* openChat(new MemoryStorage(), setup, { env });
        yield* awaited(
          (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
        );
        const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
        const [result] = results([entry]);
        expect(result!.isError).toBe(true);
        const text = resultText(result!);
        expect(text.startsWith("line-1001\n")).toBe(true);
        expect(
          ToolResultEntry.is(entry) && entry.data.diagnostics.map((diagnostic) => diagnostic.code),
        ).toEqual(["full_output", "exit_code", "truncated"]);
        expect(text).toContain("line-3000\n|<harness>\n[info] Full output: ");
        expect(text).toContain(
          "\n[error] Command exited with code 7\n[warn] Output truncated to its end: 1000 lines, ",
        );
        yield* awaited(harness.close(context));
      }),
    ),
  ),
);

describe("coding tools", () => {
  it("answers a failing command with its retained tail and diagnostics in order", () =>
    Effect.runPromise(answersFailingCommand));
});

const readsEditsRuns = Effect.asVoid(
  Effect.suspend(() =>
    withTempDir("msa-durable-coding-", (directory) =>
      Effect.gen(function* () {
        yield* writeTempFile(directory, "notes.txt", "hello world\n");
        const setup = chatSetup();
        setup.registry.install(
          defineExtension({
            name: "coding",
            tools: [createReadTool(), createEditTool(), createBashTool()],
          }),
        );
        setup.faux.setResponses([
          calls(["read", { path: "notes.txt" }, "r"]),
          calls([
            "edit",
            { path: "notes.txt", edits: [{ oldText: "world", newText: "durable" }] },
            "e",
          ]),
          calls(["bash", { command: "cat notes.txt" }, "b"]),
          DONE,
        ]);
        const env = new NodeExecutionEnv({ cwd: directory });
        const { harness, root } = yield* openChat(new MemoryStorage(), setup, { env });
        const settled = yield* awaited(
          (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
        );
        expect(settled.status).toBe("done");
        const entries = yield* allEntries(root);
        expect(
          results(entries).map((result) => [result.toolName, result.isError, resultText(result)]),
        ).toEqual([
          ["read", false, "hello world\n"],
          ["edit", false, "Successfully replaced 1 block(s) in notes.txt."],
          ["bash", false, "hello durable\n"],
        ]);
        expect(entries.at(-1)!.kind).toBe("msa.assistant");
        expect(yield* readTempFile(directory, "notes.txt")).toBe("hello durable\n");
        yield* awaited(harness.close(context));
      }),
    ),
  ),
);

describe("coding tools", () => {
  it("reads, edits, and runs a command in one run, then answers", () =>
    Effect.runPromise(readsEditsRuns));
});
