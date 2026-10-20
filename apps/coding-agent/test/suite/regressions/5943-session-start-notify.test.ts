import tui from "@msa/tui";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import harnessModule from "../harness.ts";
import SessionStartNotifySupport from "./5943-session-start-notify-support.ts";
import type SessionStartNotifySupportTypes from "./5943-session-start-notify-support.types.ts";

const { Container, Text } = tui;

const { getMessageText, interactiveModePrototype } = SessionStartNotifySupport;

const { createHarness, createTestUiContext } = harnessModule;

function createLoadedResourcesContext(): SessionStartNotifySupportTypes.LoadedResourcesContext {
  return {
    chatContainer: new Container(),
    getBuiltInCommandConflictDiagnostics: () => [],
    getStartupVisibility: () => ({ details: true, header: true }),
    isStartupExpanded: () => false,
    loadedResourcesContainer: new Container(),
    options: { verbose: true },
    session: {
      extensionRunner: {
        getCommandDiagnostics: () => [],
        getRegisteredCommands: () => [],
        getShortcutDiagnostics: () => [],
      },
      promptTemplates: [],
      resourceLoader: {
        getAgentsFiles: () => ({ agentsFiles: [{ path: "/repo/AGENTS.md" }], diagnostics: [] }),
        getAppendSystemPromptSources: () => [],
        getExtensions: () => ({ errors: [], extensions: [] }),
        getPrompts: () => ({ diagnostics: [], prompts: [] }),
        getSkills: () => ({ diagnostics: [], skills: [] }),
        getSystemPromptSource: () => undefined,
        getThemes: () => ({ diagnostics: [], themes: [] }),
      },
    },
    sessionManager: { getCwd: () => "/repo" },
    settingsManager: { getQuietStartup: () => false },
  };
}

const rendersLoadedResourcesBeforeRestoredMessages = () => {
  initTheme("dark", false);
  const context = createLoadedResourcesContext();
  const root = new Container();
  root.addChild(context.loadedResourcesContainer);
  root.addChild(context.chatContainer);
  context.loadedResourcesContainer.addChild(new Text("stale resources", 0, 0));
  context.chatContainer.addChild(new Text("restored message", 0, 0));

  interactiveModePrototype.showLoadedResources.call(context);

  const chatRendered = context.chatContainer.render(80).join("\n");
  expect(chatRendered).toContain("restored message");
  expect(chatRendered).not.toContain("[Context]");

  const rendered = root.render(80).join("\n");
  expect(rendered).not.toContain("stale resources");
  expect(rendered.indexOf("[Context]")).toBeLessThan(rendered.indexOf("restored message"));
};

const rendersReplacementSessionStateBeforeSession = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const events: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_start", (_event, ctx) => {
            ctx.ui.notify("Hello Error", "error");
          });
        },
      ],
    }),
  );

  try {
    const context: SessionStartNotifySupportTypes.RebindContext = {
      applyRuntimeSettings: () => events.push("apply"),
      bindCurrentSessionExtensions: () =>
        runPromise(
          Effect.gen(function* () {
            events.push("bind");
            yield* Effect.promise(() =>
              harness.session.bindExtensions({
                mode: "tui",
                uiContext: createTestUiContext({
                  notify: (message) => events.push(`notify:${message}`),
                }),
              }),
            );
          }),
        ),
      programStatus: { reset: () => {} },
      renderCurrentSessionState: () => events.push("render"),
      subscribeToAgent: () => events.push("subscribe"),
      updateAvailableProviderCount: () => runPromise(Effect.sync(() => {})),
      updateEditorBorderColor: () => {},
      updateTerminalTitle: () => {},
    };

    yield* Effect.promise(() =>
      interactiveModePrototype.rebindCurrentSession.call(context, { renderBeforeBind: true }),
    );

    expect(events).toEqual(["apply", "render", "subscribe", "bind", "notify:Hello Error"]);
  } finally {
    harness.cleanup();
  }
});

const subscribesBeforeReplacementSessionStartHandlersPart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const events: string[] = [];
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("session_start", () => {
              msa.sendMessage({
                content: "custom from start",
                customType: "session-start",
                display: true,
              });
            });
          },
        ],
      }),
    );
    return { events, harness, runPromise };
  });

const subscribesBeforeReplacementSessionStartHandlers = Effect.gen(function* () {
  const { events, harness, runPromise } =
    yield* subscribesBeforeReplacementSessionStartHandlersPart1();

  try {
    const context: SessionStartNotifySupportTypes.RebindContext = {
      applyRuntimeSettings: () => {},
      bindCurrentSessionExtensions: () =>
        runPromise(
          Effect.gen(function* () {
            events.push("bind");
            yield* Effect.promise(() =>
              harness.session.bindExtensions({
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
      interactiveModePrototype.rebindCurrentSession.call(context, { renderBeforeBind: true }),
    );

    expect(events).toEqual([
      "render",
      "subscribe",
      "bind",
      "message_start:custom:custom from start",
      "message_end:custom:custom from start",
    ]);
  } finally {
    harness.cleanup();
  }
});

const rendersReplacementSessionStateBeforeSessionStart = () =>
  Effect.runPromise(rendersReplacementSessionStateBeforeSession);

const subscribesBeforeReplacementSessionStartHandlersSend = () =>
  Effect.runPromise(subscribesBeforeReplacementSessionStartHandlers);

describe("regression #5943: session_start transient UI", () => {
  it(
    "renders loaded resources before restored messages without stale entries",
    rendersLoadedResourcesBeforeRestoredMessages,
  );

  it(
    "renders replacement session state before session_start handlers can notify",
    rendersReplacementSessionStateBeforeSessionStart,
  );

  it(
    "subscribes before replacement session_start handlers send messages",
    subscribesBeforeReplacementSessionStartHandlersSend,
  );
});
