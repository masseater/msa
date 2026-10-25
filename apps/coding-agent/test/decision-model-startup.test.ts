import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import decideModule from "../src/core/decision/decide.ts";
import decisionModelStartup from "../src/main/decision-model-startup.ts";
import startupChecks from "../src/main/startup-checks.ts";
import decideSupport from "./decide-support.ts";
import decisionModelStartupSupport from "./decision-model-startup-support.ts";

const { awaited, localLlmTests, pollUntil, runTest } = testing;
const { decide } = decideModule;
const { startDecisionModel } = decisionModelStartup;
const { checkStartup } = startupChecks;
const { blocking, cleanUp } = decideSupport;
const { gatedServer, sessionAt, startedRpc } = decisionModelStartupSupport;

afterEach(() => runTest(cleanUp));

const startsAtStartupAndRetriesAfterAFailure = () =>
  runTest(
    Effect.gen(function* () {
      const server = yield* gatedServer;
      const { runtime, startup } = yield* startedRpc(server.origin);
      try {
        const decideNow = decide(blocking(0.5)).pipe((effect) =>
          runtime.session.integrations.decision.provide(effect),
        );
        const requestsBeforeChecks = server.state.requests;
        const { decisionModel } = checkStartup(startup, runtime);
        yield* pollUntil(
          Effect.sync(() => server.state.requests > requestsBeforeChecks),
          200,
          "20 millis",
        );
        const beforeFetch = yield* decideNow;
        yield* server.open;
        expect(decisionModel).toBeDefined();
        const failed = yield* awaited(decisionModel!);
        server.state.serving = true;
        const afterFailure = yield* decideNow;
        yield* pollUntil(
          decideNow.pipe(Effect.map((decision) => decision.status === "decided")),
          200,
          "20 millis",
        );

        expect(requestsBeforeChecks).toBe(0);
        expect(beforeFetch.status).toBe("undecided");
        expect(failed).toMatchObject({ model: "fixture/stories", status: "failed" });
        expect(afterFailure.status).toBe("undecided");
      } finally {
        yield* awaited(runtime.dispose());
      }
    }),
  );

const skipsOfflineAndPrintMode = () =>
  runTest(
    Effect.gen(function* () {
      const server = yield* gatedServer;
      const { harness, services } = yield* sessionAt(server.origin);
      try {
        const offline = startDecisionModel(
          { appMode: "interactive", offlineMode: true },
          { services },
        );
        const print = startDecisionModel({ appMode: "print", offlineMode: false }, { services });

        expect(offline).toBeUndefined();
        expect(print).toBeUndefined();
        expect(server.state.requests).toBe(0);
      } finally {
        yield* awaited(harness.cleanup());
      }
    }),
  );

describe("decision model at startup", () => {
  it.skipIf(!localLlmTests)(
    "starts the download at startup, stays undecided until it lands, and retries after a failure",
    startsAtStartupAndRetriesAfterAFailure,
  );

  it("does not download offline or in print mode", skipsOfflineAndPrintMode);
});
