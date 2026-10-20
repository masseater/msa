import { beforeAll, describe, expect, test, vi } from "vite-plus/test";

import tuiComponent from "../../../libs/tui/src/tui-component.ts";
import type tuiComponentTypes from "../../../libs/tui/src/tui-component.types.ts";
import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import interactiveModeStatusSupport from "./interactive-mode-status-support.ts";
const { initTheme } = themeModule;

const { Container } = tuiComponent;

const { normalizeRenderedOutput } = interactiveModeStatusSupport;

function renderLastLine(container: tuiComponentTypes.Container, width = 120): string {
  const last = container.children[container.children.length - 1];
  if (!(last !== undefined)) return "";
  return last.render(width).join("\n");
}

const coalescesImmediatelySequentialStatusMessages = () => {
  const fakeThis: any = {
    chatContainer: new Container(),
    lastStatusSpacer: undefined,
    lastStatusText: undefined,
    ui: { requestRender: vi.fn() },
  };

  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  (InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
  expect(fakeThis.chatContainer.children).toHaveLength(2);
  expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_ONE");

  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  (InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");

  expect(fakeThis.chatContainer.children).toHaveLength(2);
  expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
  expect(renderLastLine(fakeThis.chatContainer)).not.toContain("STATUS_ONE");
};

const appendsANewStatusLineIfSomething = () => {
  const fakeThis: any = {
    chatContainer: new Container(),
    lastStatusSpacer: undefined,
    lastStatusText: undefined,
    ui: { requestRender: vi.fn() },
  };

  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  (InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
  expect(fakeThis.chatContainer.children).toHaveLength(2);

  fakeThis.chatContainer.addChild({ invalidate: () => {}, render: () => ["OTHER"] });
  expect(fakeThis.chatContainer.children).toHaveLength(3);

  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  (InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");

  expect(fakeThis.chatContainer.children).toHaveLength(5);
  expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
};

describe("InteractiveMode.showStatus", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test(
    "coalesces immediately-sequential status messages",
    coalescesImmediatelySequentialStatusMessages,
  );

  test(
    "appends a new status line if something else was added in between",
    appendsANewStatusLineIfSomething,
  );
});

const rendersToolUpdatesAsOneContiguousGroup = () => {
  const fakeThis: any = {
    chatContainer: new Container(),
    lastStatusSpacer: undefined,
    lastStatusText: undefined,
    managedToolStatusStarted: false,
    ui: { requestRender: vi.fn() },
  };
  const showManagedToolStatus = (InteractiveMode as any).prototype.showManagedToolStatus;

  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  showManagedToolStatus.call(fakeThis, { message: "fd downloading", type: "info" as const });
  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  showManagedToolStatus.call(fakeThis, { message: "rg downloading", type: "info" as const });
  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  showManagedToolStatus.call(fakeThis, { message: "rg failed", type: "warning" as const });

  expect(fakeThis.chatContainer.children).toHaveLength(4);
  expect(normalizeRenderedOutput(fakeThis.chatContainer)).toBe(
    "fd downloading\n rg downloading\n Warning: rg failed",
  );
};

describe("InteractiveMode.showManagedToolStatus", () => {
  beforeAll(() => initTheme("dark"));

  test("renders tool updates as one contiguous group", rendersToolUpdatesAsOneContiguousGroup);
});

const appliesExpansionStateToTheActiveHeader = () => {
  const header = { setExpanded: vi.fn() };
  const loadedResourcesChild = { setExpanded: vi.fn() };
  const chatChild = { setExpanded: vi.fn() };
  const fakeThis: any = {
    builtInHeader: header,
    chatContainer: { children: [chatChild] },
    customHeader: undefined,
    loadedResourcesContainer: { children: [loadedResourcesChild] },
    showStatus: vi.fn(),
    toolOutputExpanded: false,
    ui: { requestRender: vi.fn() },
  };

  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  (InteractiveMode as any).prototype.setToolsExpanded.call(fakeThis, true);

  expect(fakeThis.toolOutputExpanded).toBe(true);
  expect(header.setExpanded).toHaveBeenCalledWith(true);
  expect(loadedResourcesChild.setExpanded).toHaveBeenCalledWith(true);
  expect(chatChild.setExpanded).toHaveBeenCalledWith(true);
  expect(fakeThis.showStatus).toHaveBeenCalledWith("Tool output: expanded");
};

describe("InteractiveMode.setToolsExpanded", () => {
  test(
    "applies expansion state to the active header and chat entries",
    appliesExpansionStateToTheActiveHeader,
  );
});

const persistsThemeChangesToSettingsManager = () => {
  initTheme("dark");

  let currentTheme = "dark";
  const settingsManager = {
    getTheme: vi.fn(() => currentTheme),
    setTheme: vi.fn((theme: string) => {
      currentTheme = theme;
    }),
  };
  const fakeThis: any = {
    session: { settingsManager },
    settingsManager,
    themeController: {
      setThemeInstance: vi.fn(() => ({ success: true })),
      setThemeName: vi.fn(() => {
        fakeThis.ui.requestRender();
        return { success: true };
      }),
    },
    ui: { requestRender: vi.fn() },
  };

  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
  const result = uiContext.setTheme("light");

  expect(result.success).toBe(true);
  expect(fakeThis.themeController.setThemeName).toHaveBeenCalledWith("light");
  expect(settingsManager.setTheme).toHaveBeenCalledWith("light");
  expect(currentTheme).toBe("light");
  expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);
};

const doesNotPersistInvalidThemeNames = () => {
  initTheme("dark");

  const settingsManager = {
    getTheme: vi.fn(() => "dark"),
    setTheme: vi.fn(),
  };
  const fakeThis: any = {
    session: { settingsManager },
    settingsManager,
    themeController: {
      setThemeInstance: vi.fn(() => ({ success: true })),
      setThemeName: vi.fn(() => ({ error: "Theme not found", success: false })),
    },
    ui: { requestRender: vi.fn() },
  };

  Object.setPrototypeOf(fakeThis, InteractiveMode.prototype);
  const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
  const result = uiContext.setTheme("__missing_theme__");

  expect(result.success).toBe(false);
  expect(fakeThis.themeController.setThemeName).toHaveBeenCalledWith("__missing_theme__");
  expect(settingsManager.setTheme).not.toHaveBeenCalled();
  expect(fakeThis.ui.requestRender).not.toHaveBeenCalled();
};

describe("InteractiveMode.createExtensionUIContext setTheme", () => {
  test("persists theme changes to settings manager", persistsThemeChangesToSettingsManager);

  test("does not persist invalid theme names", doesNotPersistInvalidThemeNames);
});
