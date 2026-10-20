import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, expect, it } from "vite-plus/test";

import config from "../src/config.ts";
import handoffFiles from "../src/core/orchestrator/handoff-files.ts";
import SessionManager from "../src/core/session-manager.ts";
import slashCommands from "../src/core/slash-commands.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSdkSupport from "./orchestrator-sdk-support.ts";

const { handoffPrompt } = slashCommands;
const { pendingHandoffs } = handoffFiles;
const { VERSION } = config;
const { fauxAssistantMessage, fauxToolCall } = compat;

const { readTextFile, removePath, runTest } = testing;

const { harness } = orchestratorHarness;

const { waitFor } = harness;

const { createHarness, tempDir } = orchestratorSdkSupport;

afterAll(() => runTest(removePath(tempDir)));

const startsWithTheOrchestratorToolsActive = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session } = yield* createHarness();
      expect(session.tools.loadout.getActiveToolNames()).toEqual(
        expect.arrayContaining(["create_task", "list_tasks", "replan", "stop_task", "handoff"]),
      );
      expect(session.tools.prompt.systemPrompt).toContain("You work as an orchestrator");
      session.dispose();
    }),
  );

it("starts with the orchestrator tools active", startsWithTheOrchestratorToolsActive);

const savesTheThreeSectionsTheModelPasses = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session, faux } = yield* createHarness();
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall("handoff", {
              donts: "none",
              goals: "goals from the conversation",
              premise: "premise from the conversation",
            }),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done"),
      ]);

      yield* Effect.promise(() => session.run.prompting.prompt(handoffPrompt("")));

      const result = session.messages.find((message) => message.role === "toolResult");
      const [saved] = yield* Effect.promise(() => pendingHandoffs(`${tempDir}/handoffs`));
      expect(result?.content).toEqual([{ text: `${saved?.path} を読んで再開して`, type: "text" }]);
      expect(yield* readTextFile(saved?.path ?? "")).toContain("premise from the conversation");
      session.dispose();
    }),
  );

it(
  "saves the three sections the model passes to the handoff tool and answers with the line to paste",
  savesTheThreeSectionsTheModelPasses,
);

const writesAHandoffUnderTheAgentDir = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session } = yield* createHarness();
      const orchestrator = session.integrations.orchestration.orchestrator;
      if (orchestrator === undefined) throw new Error("orchestrator missing");

      const result = yield* Effect.promise(() =>
        orchestrator.handoff({ donts: "d", goals: "g", premise: "p" }),
      );

      expect(result.path.startsWith(`${tempDir}/handoffs/`)).toBe(true);
      expect(yield* readTextFile(result.path)).toContain(`- msa: ${VERSION}`);
      session.dispose();
    }),
  );

it(
  "writes a handoff under the agent dir, recording the running msa version",
  writesAHandoffUnderTheAgentDir,
);

const doesNotStartAnOrchestratorInsideA = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session } = yield* createHarness({ isWorker: true });
      expect(session.integrations.orchestration.orchestrator).toBeUndefined();
      expect(session.tools.loadout.getActiveToolNames()).not.toContain("create_task");
      session.dispose();
    }),
  );

it("does not start an orchestrator inside a worker session", doesNotStartAnOrchestratorInsideA);

const keepsWorkerTranscriptsOutOfTheSessions = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session, sessionManager, sessionDir } = yield* createHarness();
      const orchestrator = session.integrations.orchestration.orchestrator;
      if (orchestrator === undefined) throw new Error("orchestrator missing");
      const task = yield* Effect.promise(() =>
        orchestrator.createTask({
          currentState: "t is not written",
          goalState: "t works",
          title: "t",
        }),
      );
      yield* waitFor(
        () =>
          orchestrator.snapshot.tasks.find((item) => item.id === task.id)?.status === "completed",
      );
      const worker = yield* Effect.promise(() => orchestrator.read(task.id));
      const assignment = worker.assignments.find((item) => item.role === "worker");
      const sessionFile = orchestrator.snapshot.threads.find(
        (candidate) => candidate.id === assignment?.threadId,
      )?.sessionFile;
      if (sessionFile === null || sessionFile === undefined) {
        throw new Error("worker session file missing");
      }
      expect(sessionFile.slice(0, sessionDir.length + "/workers".length)).toBe(
        `${sessionDir}/workers`,
      );
      expect(SessionManager.continueRecent(tempDir, sessionDir).getSessionFile()).toBe(
        sessionManager.getSessionFile(),
      );
      session.dispose();
    }),
  );

it(
  "keeps worker transcripts out of the sessions --continue and /resume pick from",
  keepsWorkerTranscriptsOutOfTheSessions,
);
