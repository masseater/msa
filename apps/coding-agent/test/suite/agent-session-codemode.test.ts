import {
  type TranscriptContext,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";
import agentSessionCodemodeSupport2 from "./agent-session-codemode-support2.ts";

const { harnesses, setup } = agentSessionCodemodeSupport2;

const { codemodeResult, resultText, trackCodemodeWorkers } = agentSessionCodemodeSupport;

trackCodemodeWorkers();

const presentsCallableToolsPerCodemodeMode = Effect.gen(function* () {
  const harness = yield* setup();
  const description = (name: string) =>
    harness.session.agent.state.tools.find((tool) => tool.name === name)?.description ?? "";
  const requestTools: string[][] = [];
  const requestPrompts: string[] = [];
  const record = (context: TranscriptContext) => {
    requestTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
    requestPrompts.push(getCurrentSystemPrompt(context.messages));
    return fauxAssistantMessage("ok");
  };

  harness.session.setActiveToolsByName(["read", "echo", "codemode"]);
  expect(description("echo")).toContain("Codemode: `tools.echo(args)` resolves to");
  expect(description("echo")).not.toContain("codemode tool declaration:");
  expect(description("codemode")).not.toContain("### `echo`");
  harness.setResponses([record]);
  yield* Effect.promise(() => harness.session.prompt("on"));
  expect(requestTools[0]).toEqual(expect.arrayContaining(["read", "echo", "codemode"]));
  expect(requestPrompts[0]).toContain("\n- read: ");

  harness.settingsManager.applyOverrides({ codemode: { mode: "only" } });
  harness.session.setActiveToolsByName(["read", "echo", "codemode"]);
  expect(description("echo")).not.toContain("Codemode: `tools.echo");
  expect(description("codemode")).toContain("### `echo`");
  expect(description("codemode")).not.toContain("### `stats`");
  harness.setResponses([record]);
  yield* Effect.promise(() => harness.session.prompt("only"));
  expect(requestTools[1]).toContain("codemode");
  expect(requestTools[1]).not.toContain("echo");
  expect(requestTools[1]).not.toContain("read");

  expect(requestPrompts[1]).not.toContain("\n- read: ");
  expect(requestPrompts[1]).toContain("\n- codemode: ");
  expect(harness.session.systemPrompt).not.toContain("\n- read: ");

  expect(requestPrompts[1]).not.toContain("Use read to examine files");
  expect(description("codemode")).toContain("- Use read to examine files instead of cat or sed.");

  harness.session.setActiveToolsByName(["echo"]);
  expect(description("echo")).toBe("Echo text back.\n\nSecond paragraph.");
});

const showsTheGuidelinesOfToolsThat = Effect.gen(function* () {
  const harness = yield* setup();
  harness.settingsManager.applyOverrides({ codemode: { inlineBudget: 0, mode: "only" } });
  harness.session.setActiveToolsByName(["read", "codemode"]);
  const codemode = harness.session.agent.state.tools.find((tool) => tool.name === "codemode");
  expect(codemode?.description).not.toContain("### `read`");
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("codemode", { code: 'text(await describeTool("read"))' })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("go"));

  expect(resultText(codemodeResult(harness))).toContain(
    "- Use read to examine files instead of cat or sed.",
  );
});

const presentsCallableToolsPerCodemodeMode2 = () =>
  Effect.runPromise(presentsCallableToolsPerCodemodeMode);

const showsTheGuidelinesOfToolsThatDo = () => Effect.runPromise(showsTheGuidelinesOfToolsThat);

describe("AgentSession codemode tool", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("presents callable tools per codemode.mode", presentsCallableToolsPerCodemodeMode2);

  it(
    "shows the guidelines of tools that do not fit the inline budget through describeTool()",
    showsTheGuidelinesOfToolsThatDo,
  );
});
