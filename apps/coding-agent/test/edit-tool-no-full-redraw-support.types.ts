import type editToolNoFullRedrawSupport from "./edit-tool-no-full-redraw-support.ts";

declare namespace editToolNoFullRedrawSupportTypes {
  type FakeTerminal = (typeof editToolNoFullRedrawSupport.FakeTerminal)["prototype"];
}

export type { editToolNoFullRedrawSupportTypes as default };
