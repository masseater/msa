import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, expect, it } from "vite-plus/test";

import systemPrompt from "../src/core/system-prompt.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSdkSupport from "./orchestrator-sdk-support.ts";

const { ORCHESTRATOR_PREAMBLE } = systemPrompt;

const { removePath, runTest } = testing;

const { createHarness, tempDir } = orchestratorSdkSupport;

const { fauxAssistantMessage, fauxToolCall } = compat;

const { waitFor } = orchestratorHarness.harness;

type Message = compatTypes.Message;

afterAll(() => runTest(removePath(tempDir)));

const startsWithTheOrchestratorToolsActive = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session } = yield* createHarness();
      expect(session.tools.loadout.getActiveToolNames()).toEqual(
        expect.arrayContaining(["create_task", "list_tasks", "replan", "stop_task", "handoff"]),
      );
      expect(session.tools.prompt.systemPrompt).toContain(ORCHESTRATOR_PREAMBLE);
      yield* Effect.promise(() => session.dispose());
    }),
  );

it("starts with the orchestrator tools active", startsWithTheOrchestratorToolsActive);

const UNMET = "The goal asks for two things that exclude each other.";

const endsAWorkerTurnWithADecisionRequest = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { faux, session } = yield* createHarness();
      const orchestrator = session.integrations.orchestration.orchestrator;
      if (orchestrator === undefined) throw new Error("orchestrator missing");
      expect(session.tools.loadout.getActiveToolNames()).not.toContain("request_decision");
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall("request_decision", {
              options: [{ choice: "Keep one of the two", tradeoffs: "The other is dropped" }],
              unmet: UNMET,
            }),
          ],
          { stopReason: "toolUse" },
        ),
      ]);
      const task = yield* Effect.promise(() =>
        orchestrator.createTask({ currentState: "a", goalState: "b", title: "request a decision" }),
      );
      yield* waitFor(() => {
        const status = orchestrator.snapshot.tasks.find((item) => item.id === task.id)?.status;
        return status !== "waiting" && status !== "running";
      });
      const read = yield* Effect.promise(() => orchestrator.read(task.id));
      expect(read.status).toBe("needs-decision");
      expect(read.reports.at(-1)?.content).toContain(UNMET);
      yield* Effect.promise(() => session.dispose());
    }),
  );

it(
  "gives a real worker session request_decision, which ends its turn and leaves the task waiting for a decision",
  endsAWorkerTurnWithADecisionRequest,
);

const recordingDeclaredTools =
  (declared: string[][]) => (context: { messages: readonly Message[] }) => {
    const names = new Set<string>();
    for (const message of context.messages) {
      if (message.role !== "system") continue;
      for (const tool of message.toolsRemoved ?? []) names.delete(tool.name);
      for (const tool of message.toolsAdded ?? []) names.add(tool.name);
    }
    declared.push([...names].toSorted());
    return fauxAssistantMessage("Keep the first one.");
  };

const givesTriageAndAdvisorOnlyReadTools = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { faux, session } = yield* createHarness();
      const orchestrator = session.integrations.orchestration.orchestrator;
      if (orchestrator === undefined) throw new Error("orchestrator missing");
      const declared: string[][] = [];
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall("request_decision", {
              options: [{ choice: "Keep one of the two", tradeoffs: "The other is dropped" }],
              unmet: UNMET,
            }),
          ],
          { stopReason: "toolUse" },
        ),
        ...Array.from({ length: 6 }, () => recordingDeclaredTools(declared)),
      ]);
      const task = yield* Effect.promise(() =>
        orchestrator.createTask({ currentState: "a", goalState: "b", title: "read-only tools" }),
      );
      yield* waitFor(
        () =>
          orchestrator.snapshot.tasks.find((item) => item.id === task.id)?.status ===
          "needs-decision",
      );
      const triage = declared.find((names) => names.includes("conclude_triage"));
      expect(triage).toEqual(["conclude_triage", "find", "grep", "ls", "read"]);
      yield* Effect.promise(() => orchestrator.advise(task.id));
      const advisor = () =>
        declared.find(
          (names) => !names.includes("create_task") && !names.includes("conclude_triage"),
        );
      yield* waitFor(() => advisor() !== undefined);
      expect(advisor()).toEqual(["find", "grep", "ls", "read"]);
      yield* waitFor(() =>
        orchestrator.snapshot.threads.every((thread) => thread.status !== "running"),
      );
      yield* Effect.promise(() => session.dispose());
    }),
  );

it(
  "gives real triage and advisor sessions only the tools that read, and the triage its conclude_triage, with no edit, write, shell, MCP, or orchestrator tool",
  givesTriageAndAdvisorOnlyReadTools,
);
