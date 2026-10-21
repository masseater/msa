import type { Static } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type write from "./write.ts";

declare namespace writeTypes {
  type WriteToolInput = Static<typeof write.writeSchema>;

  interface WriteOperations {
    writeFile: (absolutePath: string, content: string) => Promise<void>;
    mkdir: (dir: string) => Promise<void>;
  }

  interface WriteToolOptions {
    operations?: WriteOperations;
  }

  type WriteToolContext = extensionsTypesTypes.ExtensionContext;
}

export type { writeTypes as default };
