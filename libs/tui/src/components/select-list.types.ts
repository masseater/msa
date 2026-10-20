import type SelectListClass from "./select-list.ts";

declare namespace selectListTypes {
  interface SelectItem {
    value: string;
    label: string;
    description?: string;
  }

  interface SelectListTheme {
    selectedPrefix: (text: string) => string;
    selectedText: (text: string) => string;
    description: (text: string) => string;
    scrollInfo: (text: string) => string;
    noMatch: (text: string) => string;
  }

  interface SelectListTruncatePrimaryContext {
    text: string;
    maxWidth: number;
    columnWidth: number;
    item: SelectItem;
    isSelected: boolean;
  }

  interface SelectListLayoutOptions {
    minPrimaryColumnWidth?: number;
    maxPrimaryColumnWidth?: number;
    truncatePrimary?: (context: SelectListTruncatePrimaryContext) => string;
  }

  type SelectList = SelectListClass;
}

export type { selectListTypes as default };
