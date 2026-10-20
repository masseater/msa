import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";

import ToolExecutionComponent from "../../../src/modes/interactive/components/tool-execution.ts";
import themeModule from "../../../src/modes/interactive/theme/theme.ts";
import ansi from "../../../src/utils/ansi.ts";
import interactiveModeFake from "../../interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { stripAnsi } = ansi;
const { initTheme } = themeModule;

const { Container } = tui;

function renderChat(container: tuiTypes.Container): string {
  return stripAnsi(container.render(120).join("\n"));
}

const preservesPartialBashOutput = () => {
  const ui = { requestRender: vi.fn() } as unknown as tuiTypes.TUI;
  const chatContainer = new Container();
  const component = new ToolExecutionComponent(
    "bash",
    "tool-8611",
    { command: "echo first; sleep 10" },
    { showImages: false },
    undefined,
    ui,
    process.cwd(),
  );
  component.markExecutionStarted();
  component.updateResult({ content: [{ text: "first", type: "text" }], isError: false }, true);
  chatContainer.addChild(component);
  const fakeThis = {
    chatContainer,
    hideThinkingBlock: false,
    settingsManager: { setHideThinkingBlock: vi.fn() },
    showStatus: vi.fn(),
    ui,
  };

  expect(renderChat(chatContainer)).toContain("first");
  bindModeFake(fakeThis).display.thinking.toggleThinkingBlockVisibility();

  expect(fakeThis.settingsManager.setHideThinkingBlock).toHaveBeenCalledWith(true);
  expect(chatContainer.children).toContain(component);
  expect(renderChat(chatContainer)).toContain("first");
};

describe("thinking visibility while a bash tool is running (#8611)", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  test("preserves partial bash output", preservesPartialBashOutput);
});
