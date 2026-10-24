import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, expect, it } from "vite-plus/test";

import systemPrompt from "../src/core/system-prompt.ts";
import orchestratorSdkSupport from "./orchestrator-sdk-support.ts";

const { ORCHESTRATOR_PREAMBLE } = systemPrompt;

const { removePath, runTest } = testing;

const { createHarness, tempDir } = orchestratorSdkSupport;

afterAll(() => runTest(removePath(tempDir)));

const startsWithTheOrchestratorToolsActive = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session } = yield* createHarness();
      expect(session.tools.loadout.getActiveToolNames()).toEqual(
        expect.arrayContaining(["create_task", "list_tasks", "replan", "stop_task", "handoff"]),
      );
      expect(session.tools.prompt.systemPrompt).toContain(ORCHESTRATOR_PREAMBLE);
      session.dispose();
    }),
  );

it("starts with the orchestrator tools active", startsWithTheOrchestratorToolsActive);
