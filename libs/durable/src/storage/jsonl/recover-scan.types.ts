import type typesModule from "../../types.types.ts";
import type formatTypes from "./format.types.ts";

declare namespace recoverScanTypes {
  type SidecarIndex = {
    readonly parsedFiles: Map<string, formatTypes.ParsedFile<formatTypes.SidecarRecord>>;
    readonly recordByKey: Map<string, formatTypes.ParsedLine<formatTypes.SidecarRecord>>;
  };

  type MainAnalysis = {
    readonly currentOnlyDocuments: ReadonlySet<typesModule.DocumentId>;
    readonly retiredCurrentOnlyDocuments: ReadonlySet<typesModule.DocumentId>;
    readonly finalTaskIsLive: ReadonlyMap<typesModule.TaskId, boolean>;
    readonly terminalTasks: ReadonlySet<typesModule.TaskId>;
    readonly latestBases: ReadonlyMap<typesModule.DocumentId, formatTypes.SidecarRecord>;
  };
}

export type { recoverScanTypes as default };
