import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type toolTypes from "../../src/extensions/codemode/tool.types.ts";
import closeAgentSessionModule from "../close-agent-session.ts";
import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";
import agentSessionCodemodeSupport2 from "./agent-session-codemode-support2.ts";
import type harnessTypes from "./harness.types.ts";

const { cleanupAll } = closeAgentSessionModule;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { harnesses, setup } = agentSessionCodemodeSupport2;

const { codemodeResult, resultText, trackCodemodeWorkers } = agentSessionCodemodeSupport;

const { fromJsonText } = testing;

trackCodemodeWorkers();

const runsNestedCallsInParallelAnd = Effect.gen(function* () {
  const harness = yield* setup();
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: `
							const [a, b, stats] = await Promise.all([
								tools.echo({ text: "one" }),
								tools.echo({ text: "two" }),
								tools.stats({}),
							]);
							console.log("files", stats.files);
							text(ALL_TOOLS.map((tool) => tool.name).join(","));
							return { a, b, names: stats.names };
						`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  const result = codemodeResult(harness);
  expect(result.isError).toBe(false);
  expect(resultText(result)).toBe(
    '==> text 1/2 <==\necho,stats,screenshot\n==> text 2/2 <==\n{"a":"echo: one","b":"echo: two","names":["a","b"]}\n<console_output>\nfiles 2\n</console_output>',
  );
  const details = result.details as unknown as toolTypes.CodemodeToolDetails;
  expect(details.calls.map((call) => [call.name, call.status])).toEqual([
    ["echo", "ok"],
    ["echo", "ok"],
    ["stats", "ok"],
  ]);
  expect(details.calls.every((call) => call.id.startsWith(`${result.toolCallId}/`))).toBe(true);

  const toolResults = harness.session.messages.filter((message) => message.role === "toolResult");
  expect(toolResults).toHaveLength(1);
});

const routesNestedCallsThroughExtensionHooks = Effect.gen(function* () {
  const harness = yield* setup([
    (msa) => {
      msa.on("tool_call", (event) => {
        if (event.toolName === "echo" && (event.input as { text: string }).text === "forbidden") {
          return { block: true, reason: "echo of forbidden text is blocked" };
        }
        return undefined;
      });
      msa.on("tool_result", (event) => {
        if (event.toolName === "stats") {
          return { content: [{ text: "redacted", type: "text" }] };
        }
        return undefined;
      });
    },
  ]);
  return yield* routesNestedCallsThroughExtensionHooksStep1(harness);
});

const routesNestedCallsThroughExtensionHooksStep1 = (harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("codemode", {
            code: `
							let blocked;
							try {
								await tools.echo({ text: "forbidden" });
							} catch (error) {
								blocked = error.message;
							}
							const stats = await tools.stats({});
							return { blocked, stats };
						`,
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));
    const result = codemodeResult(harness);
    expect(yield* fromJsonText(resultText(result))).toEqual({
      blocked: "echo of forbidden text is blocked",
      stats: "redacted",
    });
    const details = result.details as unknown as toolTypes.CodemodeToolDetails;
    expect(details.calls.map((call) => call.status)).toEqual(["error", "ok"]);
  });

const runsNestedCallsInParallelAndReturns = () => Effect.runPromise(runsNestedCallsInParallelAnd);

const routesNestedCallsThroughExtensionHooks2 = () =>
  Effect.runPromise(routesNestedCallsThroughExtensionHooks);

describe("AgentSession codemode tool", () => {
  afterEach(() => cleanupAll(harnesses));

  it(
    "runs nested calls in parallel and returns only the script result",
    runsNestedCallsInParallelAndReturns,
  );

  it("routes nested calls through extension hooks", routesNestedCallsThroughExtensionHooks2);
});
