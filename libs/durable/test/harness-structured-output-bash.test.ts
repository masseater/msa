import { Type } from "@msa/ai";
import { defineTool, MemoryStorage, type NestedToolExecutionResult } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { createBashTool } from "../src/tools/index.ts";
import { chatSetup, openChat } from "./chat-support.ts";
import { DONE, call, codes } from "./harness-structured-output-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { makeTempDirSync, removeDirSync } from "./temp-support.ts";

describe("structured output", () => {
  it("gives callers of bash its retained output and exit code, also for a nonzero exit", async () => {
    const directory = makeTempDirSync("msa-durable-structured-");
    try {
      const setup = chatSetup();
      addTool(setup.registry, createBashTool());
      const received: NestedToolExecutionResult[] = [];
      addTool(
        setup.registry,
        defineTool({
          name: "probe",
          description: "probe",
          parameters: Type.Object({}),
          execute: async (_args, api, callContext) => {
            received.push(await api.executeTool("bash", { command: "printf ok" }, callContext));
            received.push(
              await api.executeTool("bash", { command: "printf bad; exit 4" }, callContext),
            );
            return {};
          },
        }),
      );
      setup.faux.setResponses([call("probe"), DONE]);
      const env = new NodeExecutionEnv({ cwd: directory });
      const { harness, root } = await openChat(new MemoryStorage(), setup, { env });
      await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
      await harness.close(context);
      expect(received[0]).toMatchObject({
        isError: false,
        structuredOutput: { output: "ok", truncated: false, exitCode: 0 },
      });
      expect(received[1]).toMatchObject({
        isError: true,
        structuredOutput: { output: "bad", truncated: false, exitCode: 4 },
      });
      expect(codes(received[1]!)).toEqual(["exit_code"]);
    } finally {
      removeDirSync(directory);
    }
  });
});
