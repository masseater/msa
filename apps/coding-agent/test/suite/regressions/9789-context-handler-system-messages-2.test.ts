import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";
import ContextHandlerSystemMessagesSupport from "./9789-context-handler-system-messages-support.ts";

const { captureRequest, compactSession, compactViaHook, toolNames } =
  ContextHandlerSystemMessagesSupport;

const { createHarness } = harnessModule;

const harnesses3: harnessTypes.Harness[] = [];

const runsAfterContextHandlersOnThePart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const seen: agentTypes.AgentMessage[][] = [];
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          compactViaHook,
          (msa) => {
            msa.on("context_with_system", (event) =>
              runPromise(
                Effect.sync(() => {
                  seen.push(event.messages);
                  return {
                    messages: event.messages.map((message) =>
                      message.role === "system" && message.toolsAdded !== undefined
                        ? {
                            ...message,
                            toolsAdded: message.toolsAdded.filter((tool) => tool.name !== "bash"),
                          }
                        : message,
                    ),
                  };
                }),
              ),
            );

            msa.on("context", (event) =>
              runPromise(
                Effect.sync(() => {
                  const summary = event.messages.findIndex(
                    (message) => message.role === "compactionSummary",
                  );
                  return { messages: event.messages.slice(summary) };
                }),
              ),
            );
          },
        ],
      }),
    );
    return { harness, seen };
  });

const runsAfterContextHandlersOnThe = Effect.gen(function* () {
  const { harness, seen } = yield* runsAfterContextHandlersOnThePart1();
  harnesses3.push(harness);
  yield* Effect.promise(() => compactSession(harness));
  const getRequest = captureRequest(harness, "after compaction");

  yield* Effect.promise(() => harness.session.run.prompting.prompt("third"));

  const input = seen.at(-1);
  expect(input?.[0]?.role).toBe("system");
  expect(input?.[1]?.role).toBe("compactionSummary");
  expect(harness.session.tools.loadout.getActiveToolNames()).toContain("bash");
  expect(toolNames(getRequest())).toEqual(
    harness.session.tools.loadout.getActiveToolNames().filter((name) => name !== "bash"),
  );
});

const reportsAHandlerThatDropsThe = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("context_with_system", (event) =>
            Promise.resolve({
              messages: event.messages.filter((message) => message.role !== "system"),
            }),
          );
        },
      ],
    }),
  );
  harnesses3.push(harness);
  const errors: string[] = [];
  harness.session.extensions.binding.extensionRunner.onError((error) => {
    errors.push(`${error.event}: ${error.error}`);
  });
  const getRequest = captureRequest(harness, "done");

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));

  expect(getRequest().messages.map((message) => message.role)).toEqual(["user"]);
  expect(errors).toEqual([
    expect.stringMatching(/^context_with_system: Handler removed the leading system message/u),
  ]);
});

const runsAfterContextHandlersOnTheRestored = () =>
  Effect.runPromise(runsAfterContextHandlersOnThe);

const reportsAHandlerThatDropsTheLeading = () => Effect.runPromise(reportsAHandlerThatDropsThe);

describe("context_with_system handlers", () => {
  afterEach(() => {
    while (harnesses3.length > 0) harnesses3.pop()?.cleanup();
  });
  it(
    "runs after context handlers on the restored transcript and sends its output verbatim",
    runsAfterContextHandlersOnTheRestored,
  );
  it(
    "reports a handler that drops the leading system message but honors its output",
    reportsAHandlerThatDropsTheLeading,
  );
});
