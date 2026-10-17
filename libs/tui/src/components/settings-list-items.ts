import type { Component } from "../tui.ts";

export interface SettingItem {
  id: string;
  label: string;
  description?: string;
  currentValue: string;
  values?: string[];
  submenu?: (
    currentValue: string,
    done: (selectedValue?: string, options?: { navigateTo?: string }) => void,
  ) => Component;
}

export interface SettingsListTheme {
  label: (text: string, selected: boolean) => string;
  value: (text: string, selected: boolean) => string;
  description: (text: string) => string;
  cursor: string;
  hint: (text: string) => string;
}

export interface SettingsListOptions {
  enableSearch?: boolean;
}

export function visibleItemRange(request: {
  selectedIndex: number;
  maxVisible: number;
  itemCount: number;
}): { startIndex: number; endIndex: number } {
  const startIndex = Math.max(
    0,
    Math.min(
      request.selectedIndex - Math.floor(request.maxVisible / 2),
      request.itemCount - request.maxVisible,
    ),
  );
  return {
    startIndex,
    endIndex: Math.min(startIndex + request.maxVisible, request.itemCount),
  };
}

export const settingsHint = (searchEnabled: boolean): string =>
  searchEnabled
    ? "  Type to search · Enter/Space to change · Esc to cancel"
    : "  Enter/Space to change · Esc to cancel";
