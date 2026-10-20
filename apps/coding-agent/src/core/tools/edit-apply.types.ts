import type editDiffTypes from "./edit-diff.types.ts";

declare namespace editApplyTypes {
  interface EditOperations {
    readFile: (absolutePath: string) => Promise<Buffer>;
    writeFile: (absolutePath: string, content: string) => Promise<void>;
    access: (absolutePath: string) => Promise<void>;
  }

  interface EditRequest {
    ops: EditOperations;
    path: string;
    absolutePath: string;
    edits: editDiffTypes.Edit[];
    signal: AbortSignal | undefined;
  }
}

export type { editApplyTypes as default };
