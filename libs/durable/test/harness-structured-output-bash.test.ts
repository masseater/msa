import { Type } from "@msa/ai";
import { defineTool, type NestedToolExecutionResult } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { createBashTool } from "../src/tools/index.ts";
import { chatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { DONE, call, codes } from "./harness-structured-output-support.ts";
import { addTool } from "./harness-support.ts";
import { withTempDir } from "./platform-support.ts";
import { context } from "./session-support.ts";

const givesCallersBash = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* withTempDir("msa-durable-structured-", (directory) =>
    Effect.gen(function* () {
      const setup = chatSetup();
      addTool(setup.registry, createBashTool());
      const received: NestedToolExecutionResult[] = [];
      addTool(
        setup.registry,
        defineTool({
          name: "probe",
          description: "probe",
          parameters: Type.Object({}),
          execute: (_args, api, callContext) =>
            runPromise(
              Effect.gen(function* () {
                received.push(
                  yield* awaited(api.executeTool("bash", { command: "printf ok" }, callContext)),
                );
                received.push(
                  yield* awaited(
                    api.executeTool("bash", { command: "printf bad; exit 4" }, callContext),
                  ),
                );
                return {};
              }),
            ),
        }),
      );
      setup.faux.setResponses([call("probe"), DONE]);
      const env = new NodeExecutionEnv({ cwd: directory });
      const { harness, root } = yield* openChat(new MemoryStorage(), setup, { env });
      yield* awaited(
        (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
      );
      yield* awaited(harness.close(context));
      expect(received[0]).toMatchObject({
        isError: false,
        structuredOutput: { output: "ok", truncated: false, exitCode: 0 },
      });
      expect(received[1]).toMatchObject({
        isError: true,
        structuredOutput: { output: "bad", truncated: false, exitCode: 4 },
      });
      expect(codes(received[1]!)).toEqual(["exit_code"]);
    }),
  );
});

describe("structured output", () => {
  it("gives callers of bash its retained output and exit code, also for a nonzero exit", () =>
    Effect.runPromise(givesCallersBash));
});
