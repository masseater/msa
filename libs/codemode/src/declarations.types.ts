import type typesModule from "./types.ts";

declare namespace declarationsTypes {
  interface RenderDeclarationsOptions {
    tools?: readonly typesModule.CodemodeTool[];
    globals?: readonly typesModule.CodemodeTool[];
  }

  interface RenderToolOptions {
    inputMaxChars?: number;
  }
}

export type { declarationsTypes as default };
