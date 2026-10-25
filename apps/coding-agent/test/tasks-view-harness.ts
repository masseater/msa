import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import { vi } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import type orchestratorTypesTypes from "../src/core/orchestrator/types.types.ts";
import tasksViewHelpers from "../src/modes/interactive/components/tasks-view-helpers.ts";
import type tasksViewHelpersTypes from "../src/modes/interactive/components/tasks-view-helpers.types.ts";
import TasksView from "../src/modes/interactive/components/tasks-view.ts";
import ansi from "../src/utils/ansi.ts";

const { viewHelpers } = tasksViewHelpers;
const { stripAnsi } = ansi;

const { fauxAssistantMessage } = ai;

function task(
  id: string,
  patch: Partial<orchestratorTypesTypes.TaskSnapshot> = {},
): orchestratorTypesTypes.TaskSnapshot {
  return {
    assignments: [],
    checks: [],
    condition: null,
    createdAt: 0,
    currentState: `${id} is not written`,
    cwd: "/repo",
    dependents: [],
    dependsOn: [],
    goalState: `${id} works`,
    handoff: null,
    id,
    kind: "work",
    mergeInto: null,
    model: "fast/flash",
    project: "p",
    pullRequest: null,
    replan: null,
    reports: [],
    round: "main",
    status: "waiting",
    thinkingLevel: "low",
    title: id,
    updatedAt: 0,
    waitingReason: null,
    ...patch,
  };
}

function thread(
  id: string,
  patch: Partial<orchestratorTypesTypes.ThreadView> = {},
): orchestratorTypesTypes.ThreadView {
  return {
    branch: null,
    createdAt: 0,
    cwd: "/repo",
    id,
    model: "fast/flash",
    project: "p",
    sessionFile: null,
    status: "running",
    targetBranch: null,
    tasks: [],
    thinkingLevel: "low",
    updatedAt: 0,
    ...patch,
  };
}

const TASKS = [
  task("a", {
    assignments: [{ createdAt: 0, role: "worker", taskId: "a", threadId: "th-worker" }],
    status: "running",
  }),
  task("b", {
    dependsOn: ["a"],
    waitingReason: { detail: "waiting for a", kind: "dependencies" },
  }),
  task("c", {
    assignments: [
      { createdAt: 0, role: "worker", taskId: "c", threadId: "th-worker" },
      { createdAt: 1, role: "reviewer", taskId: "c", threadId: "th-review" },
    ],
    dependsOn: ["a"],
    reports: [
      {
        content: "c is done",
        createdAt: 1,
        id: "r1",
        role: "worker",
        status: "completed",
        taskId: "c",
        threadId: "th-worker",
        verdict: null,
      },
    ],
    status: "completed",
    title: "finished-work",
  }),
  task("d", {
    handoff: "branch feat/d · commit abc123\ntwo checks still failing",
    replan: { id: "rp-1", reason: "the api moved to v3", role: "stopped" },
    status: "stopped",
    title: "stopped-work",
  }),
  task("rev-main", {
    currentState: "Every task of round main has finished.",
    dependsOn: ["a", "b", "c", "d"],
    goalState: "Round main is reviewed as a whole.",
    kind: "review",
    title: "Review of main",
  }),
];

const THREADS = [
  thread("th-worker", { tasks: [{ role: "worker", taskId: "a" }] }),
  thread("th-review", {
    model: "sub/fable",
    status: "completed",
    tasks: [{ role: "reviewer", taskId: "c" }],
    thinkingLevel: "high",
  }),
];

function roundsOf(tasks: readonly orchestratorTypesTypes.TaskSnapshot[]) {
  return [...new Set(tasks.map((entry) => entry.round))].map((id) => ({
    id,
    reviewTaskId: tasks.find((entry) => entry.round === id && entry.kind === "review")?.id ?? null,
    taskIds: tasks.filter((entry) => entry.round === id).map((entry) => entry.id),
    title: id,
  }));
}

const DEFAULT_REPLANS: readonly orchestratorTypesTypes.ReplanView[] = [
  {
    created: [{ from: ["d"], taskId: "a", title: "a" }],
    createdAt: 1,
    dropped: [],
    id: "rp-1",
    kept: ["b"],
    reason: "the api moved to v3",
    rewired: [],
    stopped: [{ memo: "memo d", taskId: "d", threadId: "th-worker", title: "stopped-work" }],
  },
];

const fakeOrchestrator = (
  tasks: readonly orchestratorTypesTypes.TaskSnapshot[],
  snapshot: orchestratorTypesTypes.OrchestratorSnapshot,
) => {
  const messages: Record<string, agentTypes.AgentMessage[]> = {
    "th-worker": [fauxAssistantMessage("writing a.ts")],
  };
  return {
    messages: (id: string) => messages[id] ?? [],
    progress: () => ({ retrying: false, startedAt: undefined }),
    rerun: vi.fn(() => Promise.resolve(tasks[2])),
    sendMessage: vi.fn(() => Promise.resolve(tasks[1])),
    sendNote: vi.fn(() => Promise.resolve({ noteId: "n", steeredThreads: [], waitingTasks: [] })),
    setDepends: vi.fn(() => Promise.resolve([tasks[1]])),
    setState: vi.fn(() => Promise.resolve(tasks[1])),
    snapshot,
    stop: vi.fn(() => Promise.resolve(tasks[0])),
    tasks,
  };
};

function setup(
  options: {
    initialId?: string;
    state?: tasksViewHelpersTypes.TasksViewState;
    tasks?: readonly orchestratorTypesTypes.TaskSnapshot[];
    maxHeight?: number;
    replans?: readonly orchestratorTypesTypes.ReplanView[];
  } = {},
) {
  const state = options.state ?? viewHelpers.createTasksViewState();
  const tasks = options.tasks ?? TASKS;
  const snapshot: orchestratorTypesTypes.OrchestratorSnapshot = {
    maxConcurrentThreads: 4,
    replans: options.replans ?? DEFAULT_REPLANS,
    rounds: roundsOf(tasks),
    tasks,
    threads: THREADS,
  };
  const orchestrator = fakeOrchestrator(tasks, snapshot);
  const onClose = vi.fn<() => void>();
  const onPickModel = vi.fn<() => void>();
  const view = new TasksView(
    {
      maxHeight: () => options.maxHeight ?? 40,
      onClose,
      onError: () => {},
      onPickModel,
      orchestrator: orchestrator as unknown as orchestratorTypes.Orchestrator,
      requestRender: () => {},
      state,
    },
    options.initialId,
  );
  const screen = () => view.render(120).map((line) => stripAnsi(line).trimEnd());
  return { onClose, onPickModel, orchestrator, screen, view };
}

const tasksViewHarness = {
  TASKS,
  setup,
  task,
};

export default tasksViewHarness;
