import localModule from "@msa/ai/providers/local";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import decideModule from "../src/core/decision/decide.ts";
import runtimeStart from "../src/main/runtime-start.ts";
import startupModule from "../src/main/startup.ts";
import decideSupport from "./decide-support.ts";
import decisionModelStartupSupport from "./decision-model-startup-support.ts";

const { LIQUID_D1, LOCAL_PROVIDER_ID } = localModule;
const { awaited, runTest } = testing;
const { decide } = decideModule;
const { startRuntime } = runtimeStart;
const { prepareStartup } = startupModule;
const { blocking, cleanUp, tempDirectory } = decideSupport;
const { gatedServer } = decisionModelStartupSupport;

afterEach(() => {
  vi.unstubAllEnvs();
  return runTest(cleanUp);
});

const offlineRuntime = Effect.gen(function* () {
  const agentDir = yield* tempDirectory;
  vi.stubEnv("MSA_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("MSA_OFFLINE", "1");
  const boot = { agentDir, cwd: yield* tempDirectory, extensionFactories: [], offlineMode: true };
  const startup = yield* awaited(prepareStartup(["--mode", "rpc", "--no-session"], boot));
  return yield* awaited(startRuntime(startup));
});

const neverDownloadsOffline = () =>
  runTest(
    Effect.gen(function* () {
      const server = yield* gatedServer;
      yield* server.open;
      vi.stubEnv("HF_ENDPOINT", `${server.origin}/`);
      const runtime = yield* offlineRuntime;
      try {
        const decideNow = decide(blocking(0.5)).pipe((effect) =>
          runtime.session.integrations.decision.provide(effect),
        );
        const first = yield* decideNow;
        const provider = runtime.services.modelRuntime.getProvider(LOCAL_PROVIDER_ID);
        const prepared = yield* Effect.tryPromise(() =>
          provider!.prepareClassifier!(LIQUID_D1),
        ).pipe(Effect.flip);
        const afterwards = yield* decideNow;

        expect(first.status).toBe("undecided");
        expect(String(prepared.cause)).toContain("downloads are disabled");
        expect(afterwards.status).toBe("undecided");
        expect(server.state.requests).toBe(0);
      } finally {
        yield* awaited(runtime.dispose());
      }
    }),
  );

describe("decide offline", () => {
  it("uses only model files on disk and never downloads the decision model", neverDownloadsOffline);
});
