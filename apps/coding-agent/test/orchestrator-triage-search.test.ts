import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSdkSupport from "./orchestrator-sdk-support.ts";

const { removePath, runTest } = testing;
const { createHarness, tempDir } = orchestratorSdkSupport;
const { fauxAssistantMessage, fauxToolCall } = compat;
const { waitFor } = orchestratorHarness.harness;

type Message = compatTypes.Message;

afterAll(() => runTest(removePath(tempDir)));

const UNMET = "The goal asks for zirconium plating and forbids every metal finish.";

function lastToolResult(messages: readonly Message[]): string {
  const result = messages.findLast((message) => message.role === "toolResult");
  if (result?.role !== "toolResult") return "";
  return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function isTriage(messages: readonly Message[]): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      typeof message.content !== "string" &&
      message.content.some(
        (part) => part.type === "text" && part.text.startsWith("You are the triage"),
      ),
  );
}

const triageTurn =
  (search: { found: string[]; taskId: string }) => (context: { messages: readonly Message[] }) => {
    if (!isTriage(context.messages)) return fauxAssistantMessage("Keep the plating.");
    const result = lastToolResult(context.messages);
    if (result !== "") {
      search.found.push(result);
      return fauxAssistantMessage("I cannot tell.");
    }
    return fauxAssistantMessage(
      [
        fauxToolCall("search_sessions", {
          query: "zirconium",
          roles: ["worker"],
          taskIds: [search.taskId],
        }),
      ],
      { stopReason: "toolUse" },
    );
  };

const searchesTheWorkersRequestFromTheTriage = () =>
  runTest(
    Effect.gen(function* () {
      const { faux, session } = yield* createHarness();
      const orchestrator = session.integrations.orchestration.orchestrator;
      if (orchestrator === undefined) throw new Error("orchestrator missing");
      const search = { found: [] as string[], taskId: "" };
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall("request_decision", {
              options: [{ choice: "Drop the plating", tradeoffs: "The finish goes" }],
              unmet: UNMET,
            }),
          ],
          { stopReason: "toolUse" },
        ),
        ...Array.from({ length: 4 }, () => triageTurn(search)),
      ]);
      const task = yield* Effect.promise(() =>
        orchestrator.createTask({ currentState: "a", goalState: "b", title: "search from triage" }),
      );
      search.taskId = task.id;
      yield* waitFor(
        () =>
          orchestrator.snapshot.tasks.find((item) => item.id === task.id)?.status ===
          "needs-decision",
      );
      expect(search.found).toHaveLength(1);
      expect(search.found[0]).toContain(UNMET);
      expect(search.found[0]).toContain("worker");
      expect(search.found[0]).toContain(task.id);
      yield* waitFor(() =>
        orchestrator.snapshot.threads.every((thread) => thread.status !== "running"),
      );
      yield* Effect.promise(() => session.dispose());
    }),
  );

it(
  "lets a real triage session call search_sessions narrowed to its task and the worker role, and returns the worker's own request",
  searchesTheWorkersRequestFromTheTriage,
);
