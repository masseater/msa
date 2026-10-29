import type scriptOutputTypes from "../libs/ai/src/utils/script-output.types.ts";

declare namespace hiddenBuildTreeTypes {
  interface Runner {
    readonly args: ReadonlyArray<string>;
    readonly command: scriptOutputTypes.ScriptCommand;
    readonly name: string;
  }
}

export type { hiddenBuildTreeTypes as default };
