import type compatTypes from "@msa/ai/compat.types";

import type AgentSession from "../agent-session.ts";
import authGuidance from "../auth-guidance.ts";
import modelResolver from "../model-resolver.ts";
import type orchestratorTypes from "../orchestrator/orchestrator.types.ts";
import nodeChildProcess from "../platform/node/child-process.ts";

const { execFile } = nodeChildProcess;
const { resolveModelReference } = modelResolver;
const { formatNoModelSelectedMessage } = authGuidance;

function runCondition(command: string, cwd: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  execFile("/bin/sh", ["-c", command], { cwd, timeout: 60_000 }, (error) =>
    resolve(error === null),
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
    maxConcurrentThreads: settings.getOrchestratorMaxConcurrentThreads(),
    reviewModel: settings.getOrchestratorReviewModel() ?? currentReference,
    reviewThinkingLevel: settings.getOrchestratorReviewThinkingLevel() ?? session.thinkingLevel,
    workerModel: settings.getOrchestratorWorkerModel() ?? currentReference,
    workerThinkingLevel: settings.getOrchestratorWorkerThinkingLevel() ?? session.thinkingLevel,
  };
}

const orchestratorCallbacks = { defaults, resolveModel, runCondition };

export default orchestratorCallbacks;
