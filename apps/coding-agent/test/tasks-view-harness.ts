import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import { vi } from "vite-plus/test";

import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import type {
  OrchestratorSnapshot,
  ReplanView,
  TaskSnapshot,
  ThreadView,
} from "../src/core/orchestrator/types.ts";
import {
  type TasksViewState,
  viewHelpers,
} from "../src/modes/interactive/components/tasks-view-helpers.ts";
import { TasksView } from "../src/modes/interactive/components/tasks-view.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const { fauxAssistantMessage } = ai;

function task(id: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    assignments: [],
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
    model: "fast/flash",
    project: "p",
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

function thread(id: string, patch: Partial<ThreadView> = {}): ThreadView {
  return {
    createdAt: 0,
    cwd: "/repo",
    id,
    model: "fast/flash",
    project: "p",
    sessionFile: null,
    status: "running",
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

function roundsOf(tasks: readonly TaskSnapshot[]) {
  return [...new Set(tasks.map((entry) => entry.round))].map((id) => ({
    id,
    reviewTaskId: tasks.find((entry) => entry.round === id && entry.kind === "review")?.id ?? null,
    taskIds: tasks.filter((entry) => entry.round === id).map((entry) => entry.id),
    title: id,
  }));
}

const DEFAULT_REPLANS: readonly ReplanView[] = [
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

const fakeOrchestrator = (tasks: readonly TaskSnapshot[], snapshot: OrchestratorSnapshot) => {
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
    state?: TasksViewState;
    tasks?: readonly TaskSnapshot[];
    maxHeight?: number;
    replans?: readonly ReplanView[];
  } = {},
) {
  const state = options.state ?? viewHelpers.createTasksViewState();
  const tasks = options.tasks ?? TASKS;
  const snapshot: OrchestratorSnapshot = {
    maxConcurrentThreads: 4,
    replans: options.replans ?? DEFAULT_REPLANS,
    rounds: roundsOf(tasks),
    tasks,
    threads: THREADS,
  };
  const orchestrator = fakeOrchestrator(tasks, snapshot);
  const onClose = vi.fn();
  const onPickModel = vi.fn();
  const view = new TasksView(
    {
      maxHeight: () => options.maxHeight ?? 40,
      onClose,
      onError: () => {},
      onPickModel,
      orchestrator: orchestrator as unknown as Orchestrator,
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
