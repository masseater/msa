import { vi } from "vite-plus/test";

import McpManagerView from "../../src/extensions/mcp/mcp-manager-view.ts";
import themeModule from "../../src/modes/interactive/theme/theme.ts";
import interop from "../../src/utils/interop.ts";

const { callbackPromise } = interop;

const customUi = {
  custom: <T>(factory: (...args: never[]) => unknown): Promise<T> =>
    callbackPromise<T>((resolve) => {
      (factory as (...args: unknown[]) => unknown)(
        { requestRender: () => {} },
        themeModule.theme,
        {},
        (value: T) => resolve(value),
      );
    }),
};

const scriptMcpManager = (answers: (string | undefined)[]) =>
  vi
    .spyOn(McpManagerView.prototype, "menu")
    .mockImplementation(() => Promise.resolve(answers.shift()));

const initTestTheme = () => themeModule.initTheme(undefined, false);

const sepiaceTuiSupport = { customUi, initTestTheme, scriptMcpManager };

export default sepiaceTuiSupport;
