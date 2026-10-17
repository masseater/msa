import { dirname } from "node:path";

import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { LiveDoc } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { createBashTool } from "../src/tools/index.ts";
import { allEntries, chatSetup, waitFor } from "./chat-support.ts";
import { addTool } from "./harness-support.ts";
import {
  DONE,
  text,
  results,
  open,
  sqlitePath,
  removeDirectories,
} from "./harness-tools-recovery-support.ts";
import { context } from "./session-support.ts";

afterEach(removeDirectories);

describe("tool recovery", () => {
  it("answers a real bash command interrupted by close and reopen, then finishes the run", async () => {
    const path = await sqlitePath();
    const env = new NodeExecutionEnv({ cwd: dirname(path) });
    const setup = chatSetup();
    addTool(setup.registry, createBashTool());
    setup.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("bash", { command: "echo started; sleep 30" }, { id: "b" })],
        {
          stopReason: "toolUse",
        },
      ),
      DONE,
    ]);
    let opened = await open(path, setup, env);
    const id = (await opened.root.submit({ type: "input", content: "go" }, context)).id;
    await waitFor(async () => {
      const slot = (await opened.harness.snapshot(LiveDoc, opened.root.id, context))?.tools?.[0];
      return slot?.output === "started\n";
    });
    await opened.harness.close(context);

    opened = await open(path, setup, env);
    expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe(
      "done",
    );
    const [result] = results(await allEntries(opened.root));
    expect(text(result)).toBe(
      "started\n|<harness>\n[error] Tool bash was interrupted and may have partially run\n</harness>",
    );
    await opened.harness.close(context);
  });
});
