import type scriptFiles from "./script-files.ts";

declare namespace scriptFilesTypes {
  interface TempDirectoryOptions {
    readonly directory?: string | undefined;
    readonly prefix: string;
  }

  interface FileMove {
    readonly from: string;
    readonly to: string;
  }

  interface FileWrite<A> {
    readonly path: string;
    readonly content: A;
  }

  type ScriptFiles = (typeof scriptFiles.ScriptFiles)["prototype"];
}

export type { scriptFilesTypes as default };
