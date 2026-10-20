import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import durable from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/env/node.ts";
import toolsModule from "../src/tools/index.ts";
import harnessToolsRecoverySupport from "./harness-tools-recovery-support.ts";
import support from "./support.ts";

const { NodeExecutionEnv } = node;
const { createBashTool } = toolsModule;
const { LiveDoc } = durable;

const { DONE, open, removeDirectories, results, sqlitePath, text } = harnessToolsRecoverySupport;
const { addTool, allEntries, awaited, chatSetup, context, dirnameOf, waitFor } = support;

afterEach(removeDirectories);

const answersRealBash = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const env = new NodeExecutionEnv({ cwd: dirnameOf(path) });
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
  let opened = yield* open(path, setup, env);
  const id = (yield* awaited(opened.root.submit({ content: "go", type: "input" }, context))).id;
  yield* waitFor(
    Effect.gen(function* () {
      const slot = (yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context)))
        ?.tools?.[0];
      return slot?.output === "started\n";
    }),
  );
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup, env);
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  const [result] = results(yield* allEntries(opened.root));
  expect(text(result)).toBe(
    "started\n|<harness>\n[error] Tool bash was interrupted and may have partially run\n</harness>",
  );
  yield* awaited(opened.harness.close(context));
});

describe("tool recovery", () => {
  it("answers a real bash command interrupted by close and reopen, then finishes the run", () =>
    Effect.runPromise(answersRealBash));
});
