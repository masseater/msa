import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type srcTypes from "../src/index.types.ts";
import runtimeKit from "./runtime-kit.ts";

const { createFauxRuntime, disposeRuntimes } = runtimeKit;

const { awaited, runTest } = testing;

const createRuntimeHost = (extensionFactory: srcTypes.ExtensionFactory) =>
  runTest(
    Effect.map(
      createFauxRuntime({ extensionFactory, providerViaExtension: false }),
      ({ faux, runtime }) => ({ faux, runtimeHost: runtime }),
    ),
  );

const runsBeforesessioninvalidateAfterSessionShutdownAndBefore = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const phases: string[] = [];
  const { runtimeHost } = yield* awaited(
    createRuntimeHost((msa) => {
      msa.on("session_shutdown", () => {
        phases.push("session_shutdown");
      });
    }),
  );
  const oldSession = runtimeHost.session;
  runtimeHost.setBeforeSessionInvalidate(() => {
    phases.push("beforeSessionInvalidate");
    expect(oldSession.extensionRunner.createContext().cwd).toBe(oldSession.sessionManager.getCwd());
  });
  runtimeHost.setRebindSession(() =>
    effectRunPromise(
      Effect.sync(() => {
        phases.push("rebindSession");
      }),
    ),
  );

  yield* awaited(runtimeHost.newSession());

  expect(phases).toEqual(["session_shutdown", "beforeSessionInvalidate", "rebindSession"]);
  expect(() => oldSession.extensionRunner.createContext().cwd).toThrow(
    "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
  );
  runtimeHost.setBeforeSessionInvalidate(undefined);
  runtimeHost.setRebindSession(undefined);
});

const afterEachHook = disposeRuntimes;

describe("AgentSessionRuntime session lifecycle events", () => {
  afterEach(() => runTest(afterEachHook));
  it("runs beforeSessionInvalidate after session_shutdown and before rebindSession", () =>
    runTest(runsBeforesessioninvalidateAfterSessionShutdownAndBefore));
});
