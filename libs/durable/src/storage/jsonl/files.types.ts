import type envTypes from "../../env/index.types.ts";

declare namespace filesTypes {
  type JsonlFiles = {
    readonly fs: envTypes.FileSystem;
    readonly directory: string;
    readonly mainPath: string;
    readonly fsync: boolean;
  };
}

export type { filesTypes as default };
