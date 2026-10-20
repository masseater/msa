import type OutputLogClass from "./output-log.ts";

declare namespace outputLogTypes {
  type OutputLog = (typeof OutputLogClass)["prototype"];
}

export type { outputLogTypes as default };
