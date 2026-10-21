import tui from "@msa/tui";
import { Effect } from "effect";

import agentSessionRuntimeSupport from "../core/agent-session-runtime-support.ts";
import awaitingModule from "../core/awaiting.ts";
import httpDispatcher from "../core/http-dispatcher.ts";
import timings from "../core/timings.ts";
import type mainInternalTypes from "./main-internal.types.ts";
import RuntimeFactory from "./runtime-factory.ts";

const { setCapabilityOverrides, primeTerminalCapabilities } = tui;
const { createAgentSessionRuntime } = agentSessionRuntimeSupport;
const { awaited, awaiting } = awaitingModule;
const { configureHttpDispatcher, applyHttpProxySettings } = httpDispatcher;
const { time } = timings;

type Startup = mainInternalTypes.Startup;
type Runtime = mainInternalTypes.Runtime;

function startRuntime(startup: Startup): Promise<Runtime> {
  return Effect.runPromise(
    awaiting(function* () {
      const factory = new RuntimeFactory(startup);
      time("createRuntime");
      const { agentDir, sessionManager, telemetry } = startup;
      const runtime = yield* awaited(
        createAgentSessionRuntime(factory.create, {
          agentDir,
          cwd: sessionManager.getCwd(),
          sessionManager,
          ...(telemetry === undefined ? {} : { telemetry }),
        }),
      );
      time("createAgentSessionRuntime");
      const { settingsManager } = runtime.services;
      setCapabilityOverrides(settingsManager.terminal.getTerminalCapabilityOverrides());
      if (startup.appMode === "interactive")
        yield* awaited(Effect.runPromise(primeTerminalCapabilities));
      applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
      configureHttpDispatcher(settingsManager.session.getHttpIdleTimeoutMs());
      return runtime;
    }),
  );
}

const runtimeStart = { startRuntime };

export default runtimeStart;
