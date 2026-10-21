import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionBoundariesSupport from "./agent-session-boundaries-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage } = ai;

const { harnesses } = agentSessionBoundariesSupport;

const { createHarness } = harnessModule;

const commitsARetainNoneTurnEnd = Effect.gen(function* () {
  let handled = false;
  const observedIds: string[] = [];
  const requests: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("turn_end", (event) => {
            observedIds.push(event.messageEntryId);
            if (handled) return;
            handled = true;
            return {
              continue: true,
              entries: [
                {
                  details: { source: "test" },
                  firstKeptEntryId: null,
                  summary: "exact handoff",
                  type: "compaction",
                },
              ],
            };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  return yield* commitsARetainNoneTurnEndStep1(observedIds, requests, harness);
});

const commitsARetainNoneTurnEndStep1 = (
  observedIds: string[],
  requests: string[],
  harness: harnessTypes.Harness,
) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage("discarded response"),
      (context) => {
        requests.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("continued from handoff");
      },
    ]);
    yield* Effect.promise(() => harness.session.run.prompting.prompt("discarded prompt"));
    const compaction = harness.sessionManager
      .getEntries()
      .find((entry) => entry.type === "compaction");
    expect(compaction).toMatchObject({ summary: "exact handoff", type: "compaction" });
    if (compaction?.type !== "compaction") throw new Error("expected compaction");
    expect(compaction.firstKeptEntryId).toBe(compaction.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("exact handoff");
    expect(requests[0]).not.toContain("discarded prompt");
    expect(requests[0]).not.toContain("discarded response");
    expect(observedIds).toHaveLength(2);
    expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
  });

const commitsARetainNoneTurnEndCompaction = () => Effect.runPromise(commitsARetainNoneTurnEnd);

describe("AgentSession actionable boundaries", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "commits a retain-none turn_end compaction and explicitly continues once",
    commitsARetainNoneTurnEndCompaction,
  );
});

const harnessRecordingRequests = (input: {
  readonly queueKind: "steering" | "both" | "follow-up";
}) =>
  Effect.gen(function* () {
    const { queueKind } = input;
    let handled = false;
    const requests: string[] = [];
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("turn_end", () => {
              if (handled) return;
              handled = true;
              if (queueKind === "steering" || queueKind === "both") {
                msa.sendUserMessage("queued steering", { deliverAs: "steer" });
              }
              if (queueKind === "follow-up" || queueKind === "both") {
                msa.sendUserMessage("queued follow-up", { deliverAs: "followUp" });
              }
              return {
                continue: true,
                entries: [{ firstKeptEntryId: null, summary: "exact handoff", type: "compaction" }],
              };
            });
          },
        ],
      }),
    );
    return { harness, requests };
  });

describe("AgentSession actionable boundaries", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it.each(["steering", "follow-up", "both"] as const)(
    "preserves %s queue scheduling around a turn_end handoff",
    (queueKind) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { harness, requests } = yield* harnessRecordingRequests({ queueKind });
          harnesses.push(harness);
          harness.setResponses([
            fauxAssistantMessage("first"),
            (context) => {
              requests.push(JSON.stringify(context.messages));
              return fauxAssistantMessage("second");
            },
            (context) => {
              requests.push(JSON.stringify(context.messages));
              return fauxAssistantMessage("third");
            },
          ]);

          yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

          expect(requests[0]).toContain("exact handoff");
          if (queueKind === "steering") {
            expect(harness.faux.state.callCount).toBe(2);
            expect(requests[0]).toContain("queued steering");
            expect(requests[0]).not.toContain("queued follow-up");
          } else if (queueKind === "follow-up") {
            expect(harness.faux.state.callCount).toBe(2);
            expect(requests[0]).toContain("queued follow-up");
          } else {
            expect(harness.faux.state.callCount).toBe(3);
            expect(requests[0]).toContain("queued steering");
            expect(requests[0]).not.toContain("queued follow-up");
            expect(requests[1]).toContain("queued follow-up");
          }
        }),
      ),
  );
});
