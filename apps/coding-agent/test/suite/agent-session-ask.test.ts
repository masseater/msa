import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type srcTypes from "../../src/index.types.ts";
import agentSessionAskSupport from "./agent-session-ask-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, getCurrentSystemPrompt, getCurrentTools } = ai;

const { awaited, runTest, toJsonText } = testing;

const { createHarness, getUserTexts } = harnessModule;

const {
  BUILTIN_TOOLS,
  READ_ONLY_BUILTINS,
  WRITING_BUILTINS,
  cleanupHarnesses,
  declared,
  harnesses,
  record,
  setup,
} = agentSessionAskSupport;

const declaresOnlyTheReadOnlyToolsIn = () =>
  runTest(
    Effect.gen(function* () {
      const { harness } = yield* setup();
      const requests = record(harness, [fauxAssistantMessage("answer")]);

      yield* awaited(harness.session.run.prompting.prompt("/ask what does the lookup tool do?"));

      const names = declared(requests[0]);
      expect(names).toEqual(
        expect.arrayContaining([...READ_ONLY_BUILTINS, "lookup", "memory", "pr_watch"]),
      );
      expect(names).toEqual(expect.arrayContaining(["model_policy", "model_upgrade"]));
      for (const name of [...WRITING_BUILTINS, "deploy"]) expect(names).not.toContain(name);
    }),
  );

const narrowsTheToolsThatReadAndWrite = () =>
  runTest(
    Effect.gen(function* () {
      const { harness } = yield* setup();
      const requests = record(harness, [fauxAssistantMessage("answer")]);

      yield* awaited(harness.session.run.prompting.prompt("/ask what do you remember?"));

      const actions = (name: string) => {
        const tool = getCurrentTools(requests[0]?.messages ?? []).find((t) => t.name === name);
        const schema = tool?.parameters as {
          properties: { action: { anyOf?: { const: string }[]; const?: string } };
        };
        const action = schema.properties.action;
        return action.anyOf === undefined
          ? [action.const]
          : action.anyOf.map((entry) => entry.const);
      };
      expect(actions("memory")).toEqual(["search", "list"]);
      expect(actions("pr_watch")).toEqual(["list"]);
      expect(actions("model_policy")).toEqual(["list"]);
      expect(actions("model_upgrade")).toEqual(["list"]);
    }),
  );

const tellsTheModelToAnswerWithoutStarting = () =>
  runTest(
    Effect.gen(function* () {
      const { harness } = yield* setup();
      const requests = record(harness, [
        fauxAssistantMessage("answer"),
        fauxAssistantMessage("done"),
      ]);

      yield* awaited(harness.session.run.prompting.prompt("/ask can you fix the build?"));
      yield* awaited(harness.session.run.prompting.prompt("fix the build"));

      expect(getCurrentSystemPrompt(requests[0]?.messages ?? [])).toContain(
        "reply with an answer only",
      );
      expect(getCurrentSystemPrompt(requests[1]?.messages ?? [])).not.toContain(
        "reply with an answer only",
      );
    }),
  );

const goesBackToEveryToolOnThe = () =>
  runTest(
    Effect.gen(function* () {
      const { harness } = yield* setup();
      const requests = record(harness, [
        fauxAssistantMessage("answer"),
        fauxAssistantMessage("done"),
      ]);

      yield* awaited(harness.session.run.prompting.prompt("/ask can you fix the build?"));
      expect(harness.session.tools.loadout.getActiveToolNames()).toEqual(
        expect.arrayContaining([...BUILTIN_TOOLS, "lookup", "deploy"]),
      );
      yield* awaited(harness.session.run.prompting.prompt("fix the build"));

      const names = declared(requests[1]);
      expect(names).toEqual(expect.arrayContaining([...BUILTIN_TOOLS, "lookup", "deploy"]));
      const actions = getCurrentTools(requests[1]?.messages ?? []).find((t) => t.name === "memory");
      expect(yield* toJsonText(actions?.parameters)).toContain("forget");
    }),
  );

const doesNotCarryTheTurnSSelection = () =>
  runTest(
    Effect.gen(function* () {
      let turn = 0;
      const extension: srcTypes.ExtensionFactory = (msa) => {
        msa.registerTool({
          defaultActive: false,
          description: "extra description",
          execute: () =>
            Promise.resolve({ content: [{ text: "extra", type: "text" as const }], details: {} }),
          label: "extra",
          name: "extra",
          parameters: Type.Object({}),
        });
        msa.on("before_agent_start", () => {
          if (turn++ === 0) msa.setActiveTools([...msa.getActiveTools(), "extra"]);
        });
      };
      const harness = yield* awaited(
        createHarness({
          extensionFactories: [extension],
          initialActiveToolNames: BUILTIN_TOOLS,
        }),
      );
      harnesses.push(harness);
      const requests = record(harness, [
        fauxAssistantMessage("answer"),
        fauxAssistantMessage("done"),
      ]);

      yield* awaited(harness.session.run.prompting.prompt("/ask can you fix the build?"));
      yield* awaited(harness.session.run.prompting.prompt("fix the build"));

      expect(declared(requests[0])).not.toContain("extra");
      expect(declared(requests[0])).not.toContain("bash");
      expect(declared(requests[1])).toEqual(expect.arrayContaining([...BUILTIN_TOOLS, "extra"]));
    }),
  );

const keepsTheSentenceAsAnOrdinaryUser = () =>
  runTest(
    Effect.gen(function* () {
      const { harness } = yield* setup();
      record(harness, [fauxAssistantMessage("answer")]);

      yield* awaited(harness.session.run.prompting.prompt("/ask can you fix the build?"));

      expect(getUserTexts(harness)).toEqual(["can you fix the build?"]);
    }),
  );

describe("/ask", () => {
  afterEach(cleanupHarnesses);

  it("declares only the read-only tools in the turn", declaresOnlyTheReadOnlyToolsIn);

  it(
    "narrows the tools that read and write to their read actions",
    narrowsTheToolsThatReadAndWrite,
  );

  it(
    "tells the model to answer without starting work, for this turn only",
    tellsTheModelToAnswerWithoutStarting,
  );

  it("goes back to every tool on the next turn", goesBackToEveryToolOnThe);

  it(
    "does not carry the turn's selection into the next when an extension sets the active tools",
    doesNotCarryTheTurnSSelection,
  );

  it("keeps the sentence as an ordinary user message", keepsTheSentenceAsAnOrdinaryUser);
});
