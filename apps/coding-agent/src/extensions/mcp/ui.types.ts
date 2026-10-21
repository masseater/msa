import type tuiTypes from "@msa/tui/index.types";

import type McpManagerViewClass from "./mcp-manager-view.ts";

declare namespace uiTypes {
  interface McpMenu {
    title: string;

    details?: string | undefined;

    error?: string | undefined;
    items: tuiTypes.SelectItem[];

    empty?: string | undefined;

    selected?: string | undefined;

    confirmLabel: string;

    cancelLabel: string;
  }

  interface McpUi {
    menu(
      build: () => McpMenu,
      subscribe?: (listener: () => void) => () => void,
    ): Promise<string | undefined>;

    status(title: string, message: string, onCancel?: () => void): void;

    redirectUrl(
      title: string,
      authorizationUrl: string,
      signal: AbortSignal,
    ): Promise<string | undefined>;
  }

  type McpManagerView = (typeof McpManagerViewClass)["prototype"];
}

export type { uiTypes as default };
