import testing from "@msa/testing";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type agentSessionTypes from "../../../src/core/agent-session.types.ts";
import type extensionsTypes from "../../../src/core/extensions/index.types.ts";
import type srcTypes from "../../../src/index.types.ts";
import runtimeKit from "../../runtime-kit.ts";

const { awaited, runTest } = testing;
const { createFauxRuntime, disposeRuntimes } = runtimeKit;

const textOf = (message: agentSessionTypes.AgentSession["messages"][number]): string => {
  if (!("content" in message)) {
    return "";
  }
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");
};

const transcript = (session: agentSessionTypes.AgentSession): string[] =>
  session.messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role}:${textOf(message)}`);

interface ReproState {
  events: string[];
  oldCtx?: srcTypes.ExtensionCommandContext;
  oldMsa?: srcTypes.ExtensionAPI;
  oldSessionFile?: string | undefined;
  replacementSessionFile?: string | undefined;
  staleCtxThrows: boolean;
  staleMsaThrows: boolean;
}

const onReplaced =
  (state: ReproState, instance: number) => (replacedCtx: extensionsTypes.ReplacedSessionContext) =>
    runTest(
      Effect.gen(function* () {
        state.events.push(`with:${instance}`);
        state.replacementSessionFile = replacedCtx.sessionManager.getSessionFile();
        const staleCtx = yield* Effect.exit(
          Effect.sync(() => state.oldCtx?.sessionManager.getSessionFile()),
        );
        state.staleCtxThrows = Exit.isFailure(staleCtx);
        const staleMsa = yield* Effect.exit(
          Effect.sync(() => state.oldMsa?.sendUserMessage("stale message")),
        );
        state.staleMsaThrows = Exit.isFailure(staleMsa);
        yield* awaited(replacedCtx.sendUserMessage("Hello from the new session!"));
      }),
    );

const reproExtension = (state: ReproState) => {
  let instanceId = 0;
  return (msa: srcTypes.ExtensionAPI) => {
    instanceId += 1;
    const instance = instanceId;
    msa.on("session_start", () => {
      state.events.push(`start:${instance}`);
    });
    msa.on("session_shutdown", () => {
      state.events.push(`shutdown:${instance}`);
    });
    msa.registerCommand("repro", {
      description: "repro",
      handler: (_args, ctx) => {
        state.oldCtx = ctx;
        state.oldMsa = msa;
        state.oldSessionFile = ctx.sessionManager.getSessionFile();
        return ctx
          .newSession({
            ...(state.oldSessionFile === undefined ? {} : { parentSession: state.oldSessionFile }),
            withSession: onReplaced(state, instance),
          })
          .then(() => undefined);
      },
    });
  };
};

const rebindsBeforeWithSession = Effect.gen(function* () {
  const state: ReproState = { events: [], staleCtxThrows: false, staleMsaThrows: false };
  const { runtime } = yield* createFauxRuntime({
    commandActions: true,
    extensionFactory: reproExtension(state),
    responses: ["hello reply"],
  });
  expect(state.events).toEqual(["start:1"]);
  yield* awaited(runtime.session.run.prompting.prompt("/repro"));
  expect(state.events).toEqual(["start:1", "shutdown:1", "start:2", "with:1"]);
  expect(state.replacementSessionFile).toBeDefined();
  expect(state.replacementSessionFile).not.toBe(state.oldSessionFile);
  expect(state.staleCtxThrows).toBe(true);
  expect(state.staleMsaThrows).toBe(true);
  expect(transcript(runtime.session)).toEqual([
    "user:Hello from the new session!",
    "assistant:hello reply",
  ]);
});

const forkExtension = (msa: srcTypes.ExtensionAPI) => {
  msa.registerCommand("fork-it", {
    description: "fork-it",
    handler: (_args, ctx) => {
      const leafId = ctx.sessionManager.getLeafId();
      if (leafId === null || leafId === "") {
        return Promise.reject(new Error("Missing leaf id"));
      }
      return ctx
        .fork(leafId, {
          position: "at",
          withSession: (replacedCtx) => replacedCtx.sendUserMessage("fork callback message"),
        })
        .then(() => undefined);
    },
  });
};

const supportsWithSessionForFork = Effect.gen(function* () {
  const { runtime } = yield* createFauxRuntime({
    commandActions: true,
    extensionFactory: forkExtension,
    responses: ["seed reply", "fork reply"],
  });
  yield* awaited(runtime.session.run.prompting.prompt("seed"));
  yield* awaited(runtime.session.run.prompting.prompt("/fork-it"));
  expect(transcript(runtime.session)).toEqual([
    "user:seed",
    "assistant:seed reply",
    "user:fork callback message",
    "assistant:fork reply",
  ]);
});

const switchExtension = (target: { path: string }) => (msa: srcTypes.ExtensionAPI) => {
  msa.registerCommand("switch-it", {
    description: "switch-it",
    handler: (_args, ctx) =>
      ctx
        .switchSession(target.path, {
          withSession: (replacedCtx) =>
            Promise.resolve(replacedCtx.sendUserMessage("switch callback message")).then(
              () => undefined,
            ),
        })
        .then(() => undefined),
  });
};

const supportsWithSessionForSwitch = Effect.gen(function* () {
  const target = { path: "" };
  const { runtime } = yield* createFauxRuntime({
    commandActions: true,
    extensionFactory: switchExtension(target),
    responses: ["root reply", "target reply", "switch reply"],
  });
  yield* awaited(runtime.session.run.prompting.prompt("root"));
  const originalSessionPath = runtime.session.sessionFile ?? "";
  const created = yield* awaited(runtime.newSession());
  expect(created.cancelled).toBe(false);
  yield* awaited(runtime.session.run.prompting.prompt("target"));
  target.path = runtime.session.sessionFile ?? "";
  yield* awaited(runtime.switchSession(originalSessionPath));
  yield* awaited(runtime.session.run.prompting.prompt("/switch-it"));
  expect(runtime.session.sessionFile).toBe(target.path);
  expect(transcript(runtime.session)).toEqual([
    "user:target",
    "assistant:target reply",
    "user:switch callback message",
    "assistant:switch reply",
  ]);
});

describe("regression #2860: replaced session callbacks", () => {
  afterEach(() => runTest(disposeRuntimes));
  it("rebinds before withSession, targets the replacement session, and invalidates stale msa/ctx", () =>
    runTest(rebindsBeforeWithSession));
  it("supports withSession for fork", () => runTest(supportsWithSessionForFork));
  it("supports withSession for switchSession", () => runTest(supportsWithSessionForSwitch));
});
