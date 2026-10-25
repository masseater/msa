import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import awaitingModule from "../awaiting.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import toolNames from "../orchestrator/tool-names.ts";
import platform from "../platform/index.ts";
import SessionManager from "../session-manager.ts";
import sessionFiles from "../session-manager/session-files.ts";
import type sdkInternalTypes from "./sdk-internal.types.ts";

const { awaited, awaiting } = awaitingModule;
const { join } = platform;
const { getDefaultSessionDirPath } = sessionFiles;
const { ORCHESTRATOR_TOOL_NAMES, isOrchestratorTool } = toolNames;

type WorkerParent = Omit<sdkInternalTypes.SdkRuntime, "cwd"> & {
  resourceLoader: DefaultResourceLoader;
  toolModifiers: string[] | undefined;
  session: () => AgentSession;
  createAgentSession: sdkInternalTypes.CreateAgentSession;
};

type Worker = Parameters<
  NonNullable<agentSessionTypes.AgentSessionConfig["createWorkerSession"]>
>[0];

const workerSessionManager = (parent: WorkerParent, worker: Worker): Promise<SessionManager> =>
  worker.sessionFile !== undefined && worker.sessionFile !== ""
    ? SessionManager.open(worker.sessionFile)
    : Promise.resolve(
        SessionManager.create(
          worker.cwd,
          join(
            parent.sessionManager.getSessionDir() ||
              getDefaultSessionDirPath(worker.cwd, parent.agentDir),
            "workers",
          ),
        ),
      );

const READ_ONLY_TOOL_NAMES = ["read", "grep", "find", "ls"];

const readOnlyWorkerOptions = (options: {
  parent: WorkerParent;
  worker: Worker;
  resourceLoader: DefaultResourceLoader;
  sessionManager: SessionManager;
}): sdkInternalTypes.Options => {
  const { parent, worker, resourceLoader, sessionManager } = options;
  return {
    agentDir: parent.agentDir,
    customTools: [...worker.tools],
    cwd: worker.cwd,
    excludeTools: [...ORCHESTRATOR_TOOL_NAMES, "mcp__*"],
    isWorker: true,
    model: worker.model,
    modelRuntime: parent.modelRuntime,
    resourceLoader,
    sessionManager,
    settingsManager: parent.settingsManager,
    telemetry: worker.telemetry,
    thinkingLevel: worker.thinkingLevel,
    tools: [...READ_ONLY_TOOL_NAMES, ...worker.tools.map((tool) => tool.name)],
  };
};

const workerOptions = (options: {
  parent: WorkerParent;
  worker: Worker;
  resourceLoader: DefaultResourceLoader;
  sessionManager: SessionManager;
}): sdkInternalTypes.Options => {
  const { parent, worker, resourceLoader, sessionManager } = options;
  if (worker.readOnly) return readOnlyWorkerOptions(options);
  const { options: parentOptions, toolModifiers } = parent;
  const workerTools = parentOptions.tools?.filter(
    (entry) => !isOrchestratorTool(entry.replace(/^[+-]/u, "")),
  );
  return {
    agentDir: parent.agentDir,
    customTools: [...(parentOptions.customTools ?? []), ...worker.tools],
    cwd: worker.cwd,
    isWorker: true,
    model: worker.model,
    modelRuntime: parent.modelRuntime,
    resourceLoader,
    settingsManager: parent.settingsManager,
    telemetry: worker.telemetry,
    thinkingLevel: worker.thinkingLevel,
    ...(workerTools !== undefined && !(workerTools.length === 0 && toolModifiers !== undefined)
      ? { tools: workerTools }
      : {}),
    excludeTools: [...(parentOptions.excludeTools ?? []), ...ORCHESTRATOR_TOOL_NAMES],
    ...(parentOptions.noTools === undefined ? {} : { noTools: parentOptions.noTools }),
    sessionManager,
  };
};

function* createWorkerSession(parent: WorkerParent, worker: Worker) {
  const workerResourceLoader = parent.resourceLoader.fork();
  yield* awaited(workerResourceLoader.reload());
  const workerFlagValues = workerResourceLoader.getExtensions().runtime.flagValues;
  for (const [name, value] of parent.session().extensions.binding.extensionRunner.getFlagValues()) {
    workerFlagValues.set(name, value);
  }
  const sessionManager = yield* awaited(workerSessionManager(parent, worker));
  const { session: workerSession } = yield* awaited(
    parent.createAgentSession(
      workerOptions({ parent, resourceLoader: workerResourceLoader, sessionManager, worker }),
    ),
  );
  yield* awaited(workerSession.extensions.binding.bindExtensions({ mode: "print" }));
  return workerSession;
}

const workerSessionFactory =
  (parent: WorkerParent) =>
  (worker: Worker): Promise<AgentSession> =>
    Effect.runPromise(awaiting(() => createWorkerSession(parent, worker)));

const workerSessions = { workerSessionFactory };

export default workerSessions;
