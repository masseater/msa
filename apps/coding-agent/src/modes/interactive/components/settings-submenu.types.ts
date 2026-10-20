import type tuiTypes from "@msa/tui/index.types";

import type SelectSubmenuClass from "./select-submenu.ts";
import type SteppedSubmenuClass from "./stepped-submenu.ts";

declare namespace settingsSubmenuTypes {
  interface SelectSubmenuOptions {
    searchable?: boolean | undefined;
    layout?: tuiTypes.SelectListLayoutOptions | undefined;
  }

  interface SteppedSubmenuStep {
    key: string;
    title: string | ((context: Record<string, string>) => string);
    description: string | ((context: Record<string, string>) => string);
    options: (context: Record<string, string>) => tuiTypes.SelectItem[];
    preselect?: (context: Record<string, string>) => string | undefined;
    searchable?: boolean;
    layout?: tuiTypes.SelectListLayoutOptions;
  }

  type SelectSubmenu = (typeof SelectSubmenuClass)["prototype"];

  type SteppedSubmenu = (typeof SteppedSubmenuClass)["prototype"];
}

export type { settingsSubmenuTypes as default };
