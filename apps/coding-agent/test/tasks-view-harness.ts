import type { AgentMessage } from "@msa/agent-core";
import { fauxAssistantMessage } from "@msa/ai";
import { vi } from "vite-plus/test";

import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import type {
  OrchestratorSnapshot,
  ReplanView,
  ThreadView,
  TaskSnapshot,
} from "../src/core/orchestrator/types.ts";
import {
  type TasksViewState,
  viewHelpers,
} from "../src/modes/interactive/components/tasks-view-helpers.ts";
import { TasksView } from "../src/modes/interactive/components/tasks-view.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

export function task(id: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id,
    project: "p",
    round: "main",
    kind: "work",
    title: id,
    currentState: `${id} is not written`,
    goalState: `${id} works`,
    status: "waiting",
    cwd: "/repo",
    condition: null,
    model: "fast/flash",
    thinkingLevel: "low",
    createdAt: 0,
    updatedAt: 0,
    dependsOn: [],
    dependents: [],
    assignments: [],
    reports: [],
    waitingReason: null,
    handoff: null,
    replan: null,
    ...patch,
  };
}

function thread(id: string, patch: Partial<ThreadView> = {}): ThreadView {
  return {
    id,
    project: "p",
    model: "fast/flash",
    thinkingLevel: "low",
    cwd: "/repo",
    status: "running",
    sessionFile: null,
    createdAt: 0,
    updatedAt: 0,
    tasks: [],
    ...patch,
  };
}

export const TASKS = [
  task("a", {
    status: "running",
    assignments: [{ taskId: "a", threadId: "th-worker", role: "worker", createdAt: 0 }],
  }),
  task("b", {
    dependsOn: ["a"],
    waitingReason: { kind: "dependencies", detail: "waiting for a" },
  }),
  task("c", {
    title: "finished-work",
    status: "completed",
    dependsOn: ["a"],
    assignments: [
      { taskId: "c", threadId: "th-worker", role: "worker", createdAt: 0 },
      { taskId: "c", threadId: "th-review", role: "reviewer", createdAt: 1 },
    ],
    reports: [
      {
        id: "r1",
        taskId: "c",
        threadId: "th-worker",
        role: "worker",
        status: "completed",
        content: "c is done",
        createdAt: 1,
      },
    ],
  }),
  task("d", {
    status: "stopped",
    title: "stopped-work",
    handoff: "branch feat/d · commit abc123\ntwo checks still failing",
    replan: { id: "rp-1", reason: "the api moved to v3", role: "stopped" },
  }),
  task("rev-main", {
    kind: "review",
    title: "Review of main",
    currentState: "Every task of round main has finished.",
    goalState: "Round main is reviewed as a whole.",
    dependsOn: ["a", "b", "c", "d"],
  }),
];

const THREADS = [
  thread("th-worker", { tasks: [{ taskId: "a", role: "worker" }] }),
  thread("th-review", {
    model: "sub/fable",
    thinkingLevel: "high",
    status: "completed",
    tasks: [{ taskId: "c", role: "reviewer" }],
  }),
];

function roundsOf(tasks: readonly TaskSnapshot[]) {
  return [...new Set(tasks.map((task) => task.round))].map((id) => ({
    id,
    title: id,
    reviewTaskId: tasks.find((task) => task.round === id && task.kind === "review")?.id ?? null,
    taskIds: tasks.filter((task) => task.round === id).map((task) => task.id),
  }));
}

export function setup(
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
    tasks,
    threads: THREADS,
    rounds: roundsOf(tasks),
    replans: options.replans ?? [
      {
        id: "rp-1",
        reason: "the api moved to v3",
        createdAt: 1,
        stopped: [{ taskId: "d", title: "stopped-work", threadId: "th-worker", memo: "memo d" }],
        created: [{ taskId: "a", title: "a", from: ["d"] }],
        dropped: [],
        kept: ["b"],
        rewired: [],
      },
    ],
    maxConcurrentThreads: 4,
  };
  const messages: Record<string, AgentMessage[]> = {
    "th-worker": [fauxAssistantMessage("writing a.ts")],
  };
  const orchestrator = {
    snapshot,
    tasks,
    messages: (id: string) => messages[id] ?? [],
    progress: () => ({ startedAt: undefined, retrying: false }),
    stop: vi.fn(() => Promise.resolve(tasks[0])),
    sendMessage: vi.fn(() => Promise.resolve(tasks[1])),
    sendNote: vi.fn(() => Promise.resolve({ noteId: "n", steeredThreads: [], waitingTasks: [] })),
    setDepends: vi.fn(() => Promise.resolve([tasks[1]])),
    setState: vi.fn(() => Promise.resolve(tasks[1])),
    rerun: vi.fn(() => Promise.resolve(tasks[2])),
  };
  const onClose = vi.fn();
  const onPickModel = vi.fn();
  const view = new TasksView(
    {
      orchestrator: orchestrator as unknown as Orchestrator,
      onClose,
      onPickModel,
      onError: () => {},
      requestRender: () => {},
      maxHeight: () => options.maxHeight ?? 40,
      state,
    },
    options.initialId,
  );
  const screen = () => view.render(120).map((line) => stripAnsi(line).trimEnd());
  return { view, orchestrator, onClose, onPickModel, screen };
}
