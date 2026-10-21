import type tuiTypes from "@msa/tui/index.types";

import type ExtensionWidgetsClass from "./extension-widgets.ts";
import type themeTypes from "./theme/theme.types.ts";

declare namespace extensionWidgetsTypes {
  type Widget = tuiTypes.Component & { dispose?(): void };

  type WidgetContent = string[] | ((tui: tuiTypes.TUI, thm: themeTypes.Theme) => Widget);

  type ExtensionWidgets = (typeof ExtensionWidgetsClass)["prototype"];
}

export type { extensionWidgetsTypes as default };
