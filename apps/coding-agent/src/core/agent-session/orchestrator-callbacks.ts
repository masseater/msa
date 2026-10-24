import type compatTypes from "@msa/ai/compat.types";
import { Duration, Effect } from "effect";

import type AgentSession from "../agent-session.ts";
import authGuidance from "../auth-guidance.ts";
import decideModule from "../decision/decide.ts";
import type decideTypes from "../decision/decide.types.ts";
import decisionModel from "../decision/decision-model.ts";
import modelResolver from "../model-resolver.ts";
import type orchestratorTypes from "../orchestrator/orchestrator.types.ts";
import nodeChildProcess from "../platform/node/child-process.ts";

const { execFile } = nodeChildProcess;
const { resolveModelReference } = modelResolver;
const { formatNoModelSelectedMessage } = authGuidance;
const { decisionModelReference, prepareDecisionModel } = decisionModel;

const DECISION_MODEL_WAIT = Duration.minutes(10);

function exitCodeOf(error: { code?: unknown; killed?: boolean } | null): number | null {
  if (error === null) return 0;
  if (error.killed === true) return null;
  return typeof error.code === "number" ? error.code : null;
}

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<orchestratorTypes.CommandResult> {
  const { promise, resolve } = Promise.withResolvers<orchestratorTypes.CommandResult>();
  execFile(
    "/bin/sh",
    ["-c", command],
    { cwd, maxBuffer: 16 * 1024 * 1024, signal, timeout: timeoutMs },
    (error, stdout, stderr) => {
      const timedOut =
        error?.killed === true && !signal.aborted ? `\n[killed after ${timeoutMs} ms]` : "";
      const spawnError =
        error !== null && typeof error.code === "string" ? `\n${error.message}` : "";
      resolve({
        exitCode: exitCodeOf(error),
        output: `${stdout}${stderr}${timedOut}${spawnError}`,
      });
    },
  );
  return promise;
}

function resolveModel(session: AgentSession, reference: string): compatTypes.Model<any> {
  const available = session.models.selection.modelRuntimeInternal.getAvailableSnapshot();
  const result = resolveModelReference(
    { fuzzy: false, text: reference, thinkingSuffix: "none" },
    available,
    () => true,
  );
  if (result.status === "resolved") return result.model;
  const name = reference.slice(reference.indexOf("/") + 1).toLowerCase();
  const candidates = available
    .filter((model) => name !== "" && model.id.toLowerCase().includes(name))
    .map((model) => `${model.provider}/${model.id}`);
  throw new Error(
    `"${reference}" is not an available model.${
      candidates.length > 0 ? ` Use one of: ${candidates.join(", ")}` : ""
    }`,
  );
}

function defaults(session: AgentSession): orchestratorTypes.OrchestratorDefaults {
  const current = session.model;
  if (current === undefined) throw new Error(formatNoModelSelectedMessage());
  const currentReference = `${current.provider}/${current.id}`;
  const settings = session.settingsManager;
  return {
    maxConcurrentThreads: settings.session.getOrchestratorMaxConcurrentThreads(),
    reviewModel: settings.models.getOrchestratorReviewModel() ?? currentReference,
    reviewThinkingLevel:
      settings.models.getOrchestratorReviewThinkingLevel() ?? session.thinkingLevel,
    workerModel: settings.models.getOrchestratorWorkerModel() ?? currentReference,
    workerThinkingLevel:
      settings.models.getOrchestratorWorkerThinkingLevel() ?? session.thinkingLevel,
  };
}

function decide(
  session: AgentSession,
  request: decideTypes.DecideRequest,
): Promise<decideTypes.Decision> {
  const settings = session.settingsManager.models;
  const prepared = Effect.promise(() =>
    prepareDecisionModel(settings, session.models.selection.modelRuntimeInternal),
  ).pipe(
    Effect.timeoutOrElse({
      duration: DECISION_MODEL_WAIT,
      orElse: () =>
        Effect.succeed<decideTypes.DecisionModelPreparation>({
          model: decisionModelReference(settings),
          reason: `not loaded within ${Duration.format(DECISION_MODEL_WAIT)}`,
          status: "failed",
        }),
    }),
  );
  return Effect.runPromise(
    prepared.pipe(
      Effect.flatMap((preparation) =>
        preparation.status === "failed"
          ? Effect.succeed<decideTypes.Decision>({
              reason: `could not load ${preparation.model}: ${preparation.reason}`,
              status: "undecided",
            })
          : session.integrations.decision.provide(decideModule.decide(request)),
      ),
    ),
  );
}

const orchestratorCallbacks = { decide, defaults, resolveModel, runCommand };

export default orchestratorCallbacks;
