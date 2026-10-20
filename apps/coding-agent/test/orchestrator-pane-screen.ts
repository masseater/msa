import testing from "@msa/testing";
import { Container, setKeybindings } from "@msa/tui";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { TasksView } from "../src/modes/interactive/components/tasks-view.ts";
import { EditorSlot } from "../src/modes/interactive/editor-slot.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import orchestratorPaneFixtures from "./orchestrator-pane-fixtures.ts";

const { awaited, runTest } = testing;

const { createPaneUi } = orchestratorPaneFixtures;

const running: { stop: () => void }[] = [];

const prepareUi = (): void => {
  initTheme(undefined, false);
  setKeybindings(new KeybindingsManager());
};

const stopScreens = (): void => {
  for (const view of running.splice(0)) view.stop();
};

const mountPane = (options: { width?: number; orchestrator?: Orchestrator | undefined }) => {
  const { orchestrator, pane, state, terminal, ui } = createPaneUi(options);
  const editor = new CustomEditor(ui, getEditorTheme(), new KeybindingsManager());
  const container = new Container();
  container.addChild(editor);
  const slot = new EditorSlot(container, ui, () => editor);
  pane.bindKeys(editor, () =>
    slot.showSelector((done) => {
      const view = new TasksView({
        maxHeight: () => terminal.rows - 4,
        onClose: done,
        onError: () => {},
        onPickModel: () => {},
        orchestrator: orchestrator!,
        requestRender: () => ui.requestRender(),
        state,
      });
      return { component: view, dispose: pane.openThreads(), focus: view };
    }),
  );
  ui.setLayoutRoot(pane.layout(container));
  ui.start();
  ui.setFocus(editor);
  return { editor, state, terminal, ui };
};

const screen = (options: { width?: number; orchestrator?: Orchestrator | undefined } = {}) => {
  const { editor, state, terminal, ui } = mountPane(options);
  const view = {
    divider: () => terminal.getViewport()[0]!.indexOf("│"),
    editor,
    lines: () => terminal.getViewport(),
    resize: (columns: number) => {
      terminal.resize(columns, 24);
      return awaited(terminal.waitForRender());
    },
    send: (...inputs: string[]) => {
      for (const input of inputs) terminal.sendInput(input);
      return awaited(terminal.waitForRender());
    },
    state,
    stop: () => ui.stop(),
    ui,
  };
  running.push(view);
  return runTest(awaited(terminal.waitForRender())).then(() => view);
};

const orchestratorPaneScreen = {
  prepareUi,
  screen,
  stopScreens,
};

export default orchestratorPaneScreen;
