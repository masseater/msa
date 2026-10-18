import type { AgentMessage } from "@msa/agent-core";
import { fauxAssistantMessage } from "@msa/ai";
import { vi } from "vite-plus/test";

import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import type {
  OrchestratorSnapshot,
  SessionView,
  TaskSnapshot,
} from "../src/core/orchestrator/types.ts";
import {
  type TasksViewState,
  viewHelpers,
} from "../src/modes/interactive/components/tasks-view-helpers.ts";
import { TasksView } from "../src/modes/interactive/components/tasks-view.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function task(id: string, patch: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id,
    project: "p",
    round: "main",
    kind: "work",
    title: id,
    prompt: `do ${id}`,
    status: "waiting",
    priority: 0,
    cwd: "/repo",
    paths: [],
    repos: [],
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
    ...patch,
  };
}

function session(id: string, patch: Partial<SessionView> = {}): SessionView {
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
    assignments: [{ taskId: "a", sessionId: "s-worker", role: "worker", createdAt: 0 }],
    paths: ["src/a.ts"],
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
      { taskId: "c", sessionId: "s-worker", role: "worker", createdAt: 0 },
      { taskId: "c", sessionId: "s-review", role: "reviewer", createdAt: 1 },
    ],
    reports: [
      {
        id: "r1",
        taskId: "c",
        sessionId: "s-worker",
        role: "worker",
        status: "completed",
        content: "c is done",
        createdAt: 1,
      },
    ],
  }),
  task("d", { status: "stopped", title: "stopped-work" }),
  task("rev-main", {
    kind: "review",
    title: "Review of main",
    priority: -1000,
    dependsOn: ["a", "b", "c", "d"],
  }),
];

const SESSIONS = [
  session("s-worker", { tasks: [{ taskId: "a", role: "worker" }] }),
  session("s-review", {
    model: "sub/fable",
    thinkingLevel: "high",
    status: "completed",
    tasks: [{ taskId: "c", role: "reviewer" }],
  }),
];

export function setup(options: { initialId?: string; state?: TasksViewState } = {}) {
  const state = options.state ?? viewHelpers.createTasksViewState();
  const snapshot: OrchestratorSnapshot = {
    tasks: TASKS,
    sessions: SESSIONS,
    rounds: [
      { id: "main", title: "main", reviewTaskId: "rev-main", taskIds: TASKS.map((t) => t.id) },
    ],
    maxConcurrentSessions: 4,
  };
  const messages: Record<string, AgentMessage[]> = {
    "s-worker": [fauxAssistantMessage("writing a.ts")],
  };
  const orchestrator = {
    snapshot,
    tasks: TASKS,
    messages: (id: string) => messages[id] ?? [],
    progress: () => ({ startedAt: undefined, retrying: false }),
    stop: vi.fn(() => Promise.resolve(TASKS[0])),
    sendMessage: vi.fn(() => Promise.resolve(TASKS[1])),
    sendNote: vi.fn(() => Promise.resolve({ noteId: "n", steeredSessions: [], waitingTasks: [] })),
    setPriority: vi.fn(() => Promise.resolve(TASKS[1])),
    rerun: vi.fn(() => Promise.resolve(TASKS[2])),
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
      maxHeight: () => 40,
      state,
    },
    options.initialId,
  );
  const screen = () => view.render(120).map((line) => stripAnsi(line).trimEnd());
  return { view, orchestrator, onClose, onPickModel, screen };
}
