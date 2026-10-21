import ai from "@msa/ai";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import node from "../src/env/node.ts";
import toolsModule from "../src/tools/index.ts";
import harnessStructuredOutputSupport from "./harness-structured-output-support.ts";
import support from "./support.ts";

const { Type } = ai;

const { createBashTool } = toolsModule;
const { defineTool } = durable;
const { NodeExecutionEnv } = node;
const { MemoryStorage } = memory;

const { DONE, call, codes } = harnessStructuredOutputSupport;
const { addTool, awaited, chatSetup, context, openChat, withTempDir } = support;

const givesCallersBash = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* withTempDir("msa-durable-structured-", (directory) =>
    Effect.gen(function* () {
      const setup = chatSetup();
      addTool(setup.registry, createBashTool());
      const received: durableTypes.NestedToolExecutionResult[] = [];
      addTool(
        setup.registry,
        defineTool({
          description: "probe",
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
          name: "probe",
          parameters: Type.Object({}),
        }),
      );
      setup.faux.setResponses([call("probe"), DONE]);
      const env = new NodeExecutionEnv({ cwd: directory });
      const { harness, root } = yield* openChat(new MemoryStorage(), setup, { env });
      yield* awaited(
        (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
      );
      yield* awaited(harness.close(context));
      expect(received[0]).toMatchObject({
        isError: false,
        structuredOutput: { exitCode: 0, output: "ok", truncated: false },
      });
      expect(received[1]).toMatchObject({
        isError: true,
        structuredOutput: { exitCode: 4, output: "bad", truncated: false },
      });
      expect(codes(received[1]!)).toEqual(["exit_code"]);
    }),
  );
});

describe("structured output", () => {
  it("gives callers of bash its retained output and exit code, also for a nonzero exit", () =>
    Effect.runPromise(givesCallersBash));
});
