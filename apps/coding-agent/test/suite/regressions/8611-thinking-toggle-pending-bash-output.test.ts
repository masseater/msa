import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";

import ToolExecutionComponent from "../../../src/modes/interactive/components/tool-execution.ts";
import themeModule from "../../../src/modes/interactive/theme/theme.ts";
import interactiveModeFake from "../../interactive-mode-fake.ts";
import tuiKit from "../../tui-kit.ts";

const { bindModeFake } = interactiveModeFake;

const { initTheme } = themeModule;
const { renderChat } = tuiKit;

const { Container } = tui;

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
    settingsManager: { display: { setHideThinkingBlock: vi.fn() } },
    showStatus: vi.fn(),
    ui,
  };

  expect(renderChat(chatContainer)).toContain("first");
  bindModeFake(fakeThis).display.thinking.toggleThinkingBlockVisibility();

  expect(fakeThis.settingsManager.display.setHideThinkingBlock).toHaveBeenCalledWith(true);
  expect(chatContainer.children).toContain(component);
  expect(renderChat(chatContainer)).toContain("first");
};

describe("thinking visibility while a bash tool is running (#8611)", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  test("preserves partial bash output", preservesPartialBashOutput);
});
