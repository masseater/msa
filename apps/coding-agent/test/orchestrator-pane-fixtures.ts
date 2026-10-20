import testing from "@msa/testing";
import type { Terminal } from "@msa/tui";

import { VirtualTerminal } from "../../../libs/tui/test/virtual-terminal.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import type { OrchestratorSnapshot, TaskSnapshot } from "../src/core/orchestrator/types.ts";
import { viewHelpers } from "../src/modes/interactive/components/tasks-view-helpers.ts";
import { OrchestratorPane } from "../src/modes/interactive/orchestrator-pane.ts";
import { createInteractiveTui } from "../src/modes/interactive/tui-renderer.ts";
import tasksViewHarness from "./tasks-view-harness.ts";

const { currentTimeMillis } = testing;

const { task } = tasksViewHarness;

const FIRST = "01a1518a-ff46-75e6-90be-7024913caa86";

const orchestratorFor = (tasks: readonly TaskSnapshot[]): Orchestrator => {
  const snapshot: OrchestratorSnapshot = {
    maxConcurrentThreads: 4,
    replans: [],
    rounds: [...new Set(tasks.map((entry) => entry.round))].map((id) => ({
      id,
      reviewTaskId: null,
      taskIds: tasks.filter((entry) => entry.round === id).map((entry) => entry.id),
      title: id,
    })),
    tasks,
    threads: [],
  };
  return { refresh: () => Promise.resolve(), snapshot } as unknown as Orchestrator;
};

const paneTasks = (): TaskSnapshot[] => {
  const now = currentTimeMillis();
  return [
    task(FIRST, {
      currentState: "the screen has one pane",
      goalState: "the pane splits 7:3",
      reports: [
        {
          content: "the divider renders",
          createdAt: now - 60_000,
          id: "r1",
          role: "worker",
          status: "running",
          taskId: FIRST,
          threadId: "s1",
        },
      ],
      status: "running",
      title: "build the pane",
      updatedAt: now - 120_000,
    }),
    task("b", { dependsOn: [FIRST], title: "wire the keys", updatedAt: now - 300_000 }),
  ];
};

const createPaneUi = (options: { width?: number; orchestrator?: Orchestrator | undefined }) => {
  const terminal = new VirtualTerminal(options.width ?? 100, 24);
  const ui = createInteractiveTui({
    logDirectory: "/tmp",
    showHardwareCursor: false,
    terminal: terminal as unknown as Terminal,
    tuiMode: "fullscreen",
  });
  const orchestrator =
    "orchestrator" in options ? options.orchestrator : orchestratorFor(paneTasks());
  const state = viewHelpers.createTasksViewState();
  const pane = new OrchestratorPane({
    columns: () => terminal.columns,
    orchestrator: () => orchestrator,
    requestRender: () => ui.requestRender(),
    rows: () => terminal.rows,
    state,
  });
  return { orchestrator, pane, state, terminal, ui };
};

const orchestratorPaneFixtures = {
  FIRST,
  createPaneUi,
  orchestratorFor,
  paneTasks,
};

export default orchestratorPaneFixtures;
