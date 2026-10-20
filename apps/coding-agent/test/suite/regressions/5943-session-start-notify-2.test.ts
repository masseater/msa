import ai from "@msa/ai";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import themeModule from "../../../src/modes/interactive/theme/theme.ts";
import interactiveModeFake from "../../interactive-mode-fake.ts";
import harnessModule from "../harness.ts";
import SessionStartNotifySupport from "./5943-session-start-notify-support.ts";
import type SessionStartNotifySupportTypes from "./5943-session-start-notify-support.types.ts";

const { bindModeFake } = interactiveModeFake;

const { initTheme } = themeModule;

const { fauxAssistantMessage } = ai;

const { createReloadCommandContext, getMessageText } = SessionStartNotifySupport;

const { createHarness, createTestUiContext } = harnessModule;

const subscribesBeforeReplacementSessionStartHandlers2Part1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const events: string[] = [];
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("session_start", () => {
              msa.sendUserMessage("user from start");
            });
          },
        ],
      }),
    );
    return { events, harness, runPromise };
  });

const subscribesBeforeReplacementSessionStartHandlers2 = Effect.gen(function* () {
  const { events, harness, runPromise } =
    yield* subscribesBeforeReplacementSessionStartHandlers2Part1();
  harness.setResponses([fauxAssistantMessage("assistant from start")]);

  try {
    const context: SessionStartNotifySupportTypes.RebindContext = {
      applyRuntimeSettings: () => {},
      bindCurrentSessionExtensions: () =>
        runPromise(
          Effect.gen(function* () {
            events.push("bind");
            yield* Effect.promise(() =>
              harness.session.extensions.binding.bindExtensions({
                mode: "tui",
                uiContext: createTestUiContext(),
              }),
            );
          }),
        ),
      programStatus: { reset: () => {} },
      renderCurrentSessionState: () => events.push("render"),
      subscribeToAgent: () => {
        events.push("subscribe");
        harness.session.subscribe((event) => {
          if (event.type !== "message_start" && event.type !== "message_end") {
            return;
          }
          events.push(`${event.type}:${event.message.role}:${getMessageText(event)}`);
        });
      },
      updateAvailableProviderCount: () => runPromise(Effect.sync(() => {})),
      updateEditorBorderColor: () => {},
      updateTerminalTitle: () => {},
    };

    yield* Effect.promise(() =>
      bindModeFake(context).extensions.binding.rebindCurrentSession({ renderBeforeBind: true }),
    );
    yield* Effect.promise(() => harness.session.agent.waitForIdle());

    expect(events.slice(0, 3)).toEqual(["render", "subscribe", "bind"]);
    expect(events).toContain("message_start:user:user from start");
    expect(events).toContain("message_end:user:user from start");
    expect(events).toContain("message_end:assistant:assistant from start");
  } finally {
    harness.cleanup();
  }
});

const runsTheReloadRenderHookBefore = Effect.gen(function* () {
  const events: string[] = [];
  const beforeSessionStart = vi.fn(() => {
    events.push("render");
  });
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_start", (event, ctx) => {
            events.push(`start:${event.reason}`);
            ctx.ui.notify(`notify:${event.reason}`, "error");
          });
        },
      ],
    }),
  );

  try {
    yield* Effect.promise(() =>
      harness.session.extensions.binding.bindExtensions({
        mode: "tui",
        uiContext: createTestUiContext({ notify: (message) => events.push(message) }),
      }),
    );
    expect(events).toEqual(["start:startup", "notify:startup"]);

    events.length = 0;
    yield* Effect.promise(() => harness.session.extensions.runtime.reload({ beforeSessionStart }));

    expect(beforeSessionStart).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["render", "start:reload", "notify:reload"]);
  } finally {
    harness.cleanup();
  }
});

const refreshesHidethinkingblockBeforeRebuildingChatDuring = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  initTheme("dark", false);
  const events: string[] = [];
  let context: SessionStartNotifySupportTypes.ReloadCommandContext;
  context = createReloadCommandContext({
    rebuildChatFromMessages: () => {
      events.push(`rebuild:${context.hideThinkingBlock}`);
    },
    session: {
      extensions: {
        runtime: {
          reload: (options) =>
            runPromise(
              Effect.gen(function* () {
                events.push("reload");
                yield* Effect.promise(() => Promise.resolve(options?.beforeSessionStart?.()));
                events.push(`start:${context.hideThinkingBlock}`);
              }),
            ),
        },
      },
    },
    settingsManager: { getHideThinkingBlock: () => true },
  });

  bindModeFake(context);
  yield* Effect.promise(() => bindModeFake(context).commands.reload.handleReloadCommand());

  expect(context.hideThinkingBlock).toBe(true);
  expect(events).toEqual(["reload", "rebuild:true", "start:true"]);
});

const subscribesBeforeReplacementSessionStartHandlersSend2 = () =>
  Effect.runPromise(subscribesBeforeReplacementSessionStartHandlers2);

const runsTheReloadRenderHookBeforeReload = () => Effect.runPromise(runsTheReloadRenderHookBefore);

const refreshesHidethinkingblockBeforeRebuildingChatDuringReload = () =>
  Effect.runPromise(refreshesHidethinkingblockBeforeRebuildingChatDuring);

describe("regression #5943: session_start transient UI", () => {
  it(
    "subscribes before replacement session_start handlers send user messages",
    subscribesBeforeReplacementSessionStartHandlersSend2,
  );

  it(
    "runs the reload render hook before reload session_start handlers can notify",
    runsTheReloadRenderHookBeforeReload,
  );

  it(
    "refreshes hideThinkingBlock before rebuilding chat during reload",
    refreshesHidethinkingblockBeforeRebuildingChatDuringReload,
  );
});
