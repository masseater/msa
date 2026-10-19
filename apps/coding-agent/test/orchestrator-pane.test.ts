import { Container, setKeybindings, type Terminal } from "@msa/tui";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { VirtualTerminal } from "../../../libs/tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import type { OrchestratorSnapshot, TaskSnapshot } from "../src/core/orchestrator/types.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { SessionPane } from "../src/modes/interactive/components/session-pane.ts";
import { viewHelpers } from "../src/modes/interactive/components/tasks-view-helpers.ts";
import { TasksView } from "../src/modes/interactive/components/tasks-view.ts";
import { EditorSlot } from "../src/modes/interactive/editor-slot.ts";
import { OrchestratorPane } from "../src/modes/interactive/orchestrator-pane.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { createInteractiveTui } from "../src/modes/interactive/tui-renderer.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { task } from "./tasks-view-harness.ts";

const SHIFT_RIGHT = "\x1b[1;2C";
const SHIFT_LEFT = "\x1b[1;2D";
const CTRL_SHIFT_RIGHT = "\x1b[1;6C";
const CTRL_SHIFT_LEFT = "\x1b[1;6D";
const DOWN = "\x1b[B";
const ESC = "\x1b";
const FIRST = "01a1518a-ff46-75e6-90be-7024913caa86";

beforeAll(() => {
  initTheme(undefined, false);
  setKeybindings(new KeybindingsManager());
});

function orchestratorFor(tasks: readonly TaskSnapshot[]): Orchestrator {
  const snapshot: OrchestratorSnapshot = {
    tasks,
    sessions: [],
    rounds: [...new Set(tasks.map((entry) => entry.round))].map((id) => ({
      id,
      title: id,
      reviewTaskId: null,
      taskIds: tasks.filter((entry) => entry.round === id).map((entry) => entry.id),
    })),
    replans: [],
    maxConcurrentSessions: 4,
  };
  return { snapshot, refresh: async () => {} } as unknown as Orchestrator;
}

function paneTasks(): TaskSnapshot[] {
  return [
    task(FIRST, {
      title: "build the pane",
      status: "running",
      updatedAt: Date.now() - 120_000,
      currentState: "the screen has one pane",
      goalState: "the pane splits 7:3",
      reports: [
        {
          id: "r1",
          taskId: FIRST,
          sessionId: "s1",
          role: "worker",
          status: "running",
          content: "the divider renders",
          createdAt: Date.now() - 60_000,
        },
      ],
    }),
    task("b", { title: "wire the keys", updatedAt: Date.now() - 300_000, dependsOn: [FIRST] }),
  ];
}

const running: { stop: () => void }[] = [];

afterEach(() => {
  for (const view of running.splice(0)) view.stop();
});

async function screen(options: { width?: number; orchestrator?: Orchestrator | undefined } = {}) {
  const terminal = new VirtualTerminal(options.width ?? 100, 24);
  const ui = createInteractiveTui({
    tuiMode: "fullscreen",
    showHardwareCursor: false,
    logDirectory: "/tmp",
    terminal: terminal as unknown as Terminal,
  });
  const orchestrator =
    "orchestrator" in options ? options.orchestrator : orchestratorFor(paneTasks());
  const state = viewHelpers.createTasksViewState();
  const pane = new OrchestratorPane({
    orchestrator: () => orchestrator,
    state,
    columns: () => terminal.columns,
    rows: () => terminal.rows,
    requestRender: () => ui.requestRender(),
  });
  const editor = new CustomEditor(ui, getEditorTheme(), new KeybindingsManager());
  const container = new Container();
  container.addChild(editor);
  const slot = new EditorSlot(container, ui, () => editor);
  pane.bindKeys(editor, () =>
    slot.showSelector((done) => {
      const view = new TasksView({
        orchestrator: orchestrator!,
        onClose: done,
        onPickModel: () => {},
        onError: () => {},
        requestRender: () => ui.requestRender(),
        maxHeight: () => terminal.rows - 4,
        state,
      });
      return { component: view, focus: view, dispose: pane.openSessions() };
    }),
  );
  ui.setLayoutRoot(pane.layout(container));
  ui.start();
  ui.setFocus(editor);
  const view = {
    ui,
    editor,
    state,
    stop: () => ui.stop(),
    async send(...inputs: string[]) {
      for (const input of inputs) terminal.sendInput(input);
      await terminal.waitForRender();
    },
    async resize(columns: number) {
      terminal.resize(columns, 24);
      await terminal.waitForRender();
    },
    lines: () => terminal.getViewport(),
    divider: () => terminal.getViewport()[0]!.indexOf("│"),
  };
  running.push(view);
  await terminal.waitForRender();
  return view;
}

const press = (column: number) => `\x1b[<0;${column + 1};3M`;
const drag = (column: number) => `\x1b[<32;${column + 1};3M`;
const release = (column: number) => `\x1b[<0;${column + 1};3m`;

describe("orchestrator pane layout", () => {
  it("splits the screen 7:3 with a divider on every row", async () => {
    const view = await screen();
    expect(view.divider()).toBe(69);
    expect(view.lines().every((line) => line[69] === "│")).toBe(true);
    expect(view.lines()[0]).toContain("Sessions");
  });

  it("moves the divider when it is dragged with the mouse", async () => {
    const view = await screen();
    await view.send(press(69), drag(55), drag(49), release(49));
    expect(view.divider()).toBe(49);
    expect(view.lines()[0]!.slice(50)).toContain("Sessions");
  });

  it("moves the divider with ctrl+shift+arrows", async () => {
    const view = await screen();
    await view.send(CTRL_SHIFT_LEFT);
    expect(view.divider()).toBe(67);
    await view.send(CTRL_SHIFT_RIGHT);
    expect(view.divider()).toBe(69);
  });

  it("keeps the dragged share when the terminal resizes", async () => {
    const view = await screen();
    await view.send(press(69), drag(49), release(49));
    await view.resize(200);
    expect(view.divider()).toBe(98);
  });

  it("hides the pane once it would be narrower than 24 columns", async () => {
    const view = await screen();
    await view.resize(79);
    expect(view.divider()).toBe(-1);
    expect(view.lines().join("\n")).not.toContain("Sessions");

    await view.resize(80);
    expect(view.divider()).toBe(55);
    expect(view.lines()[0]).toContain("Sessions");
  });

  it("hides a widened pane once the conversation would be narrower than 40 columns", async () => {
    const view = await screen();
    await view.send(press(69), drag(20), release(20));
    expect(view.divider()).toBe(40);
    await view.resize(90);
    expect(view.divider()).toBe(-1);
    await view.resize(100);
    expect(view.divider()).toBe(40);
  });

  it("hides the pane when dragged past its minimum and brings it back with the widen key", async () => {
    const view = await screen();
    await view.send(press(69), drag(90), release(90));
    expect(view.divider()).toBe(-1);
    await view.send(CTRL_SHIFT_LEFT);
    expect(view.divider()).toBe(75);
  });

  it("draws one pane without an orchestrator and ignores the pane keys", async () => {
    const view = await screen({ orchestrator: undefined });
    await view.send(SHIFT_RIGHT, CTRL_SHIFT_LEFT);
    expect(view.divider()).toBe(-1);
    expect(view.lines().join("\n")).not.toContain("Sessions");
    expect(view.ui.getFocusedComponent()).toBe(view.editor);
  });
});

describe("sessions view from the pane", () => {
  it("opens /sessions full width with shift+right and returns with escape", async () => {
    const view = await screen();
    await view.send(SHIFT_RIGHT);
    expect(view.ui.getFocusedComponent()).toBeInstanceOf(TasksView);
    expect(view.divider()).toBe(-1);
    expect(view.lines().join("\n")).toContain("build the pane");

    await view.send(ESC);
    expect(view.ui.getFocusedComponent()).toBe(view.editor);
    expect(view.divider()).toBe(69);
  });

  it("returns with shift+left", async () => {
    const view = await screen();
    await view.send(SHIFT_RIGHT, SHIFT_LEFT);
    expect(view.ui.getFocusedComponent()).toBe(view.editor);
    expect(view.divider()).toBe(69);
  });

  it("keeps the selection made in /sessions in the pane", async () => {
    const view = await screen();
    await view.send(SHIFT_RIGHT, DOWN, ESC);
    expect(view.state.selectedId).toBe("b");
    const pane = view
      .lines()
      .map((line) => line.slice(70))
      .join("\n");
    expect(pane).toContain("› ○ wire the keys");
    expect(pane).toContain("build the pane");
  });
});

describe("orchestrator pane contents", () => {
  it("summarizes the list and the selected task", () => {
    const tasks = paneTasks();
    const orchestrator = orchestratorFor(tasks);
    const state = { showFinished: false, selectedId: FIRST };
    const pane = new SessionPane({ orchestrator: () => orchestrator, state, height: () => 40 });
    const text = stripAnsi(pane.render(48).join("\n"));
    expect(text).toContain("› ● build the pane");
    expect(text).toContain("01a1518a · flash · 2m ago");
    expect(text).toContain("○ wire the keys");
    expect(text).toContain("● running · main");
    expect(text).toContain("now    the screen has one pane");
    expect(text).toContain("goal   the pane splits 7:3");
    expect(text).toContain("report 1m ago worker: the divider renders");
    expect(text.match(/the divider renders/g)).toHaveLength(1);

    state.selectedId = "b";
    expect(stripAnsi(pane.render(48).join("\n"))).toContain("deps   ● build the pane");
  });

  it("fits its width and height", () => {
    const pane = new SessionPane({
      orchestrator: () => orchestratorFor(paneTasks()),
      state: viewHelpers.createTasksViewState(),
      height: () => 10,
    });
    const lines = pane.render(24);
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.every((line) => stripAnsi(line).length <= 24)).toBe(true);
  });
});
