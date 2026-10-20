import type focusPanelTypes from "./focus-panel.types.ts";

const FOCUS_PANEL_CONFIGS = [
  { color: "error", label: "Alpha", options: { col: 4, row: 2, width: 34 } },
  { color: "success", label: "Beta", options: { col: 28, row: 5, width: 34 } },
  { color: "accent", label: "Gamma", options: { col: 52, row: 8, width: 34 } },
] satisfies focusPanelTypes.FocusPanelConfig[];

const focusPanelConfigs = {
  FOCUS_PANEL_CONFIGS,
};

export default focusPanelConfigs;
