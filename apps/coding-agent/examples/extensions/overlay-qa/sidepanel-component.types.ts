import type SidepanelComponentClass from "./sidepanel-component.ts";

declare namespace sidepanelComponentTypes {
  type SidepanelComponent = (typeof SidepanelComponentClass)["prototype"];
}

export type { sidepanelComponentTypes as default };
