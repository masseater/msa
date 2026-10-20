import type connectionTypes from "./connection.types.ts";
import type fileOpTypes from "./file-op.types.ts";

declare namespace dirOpsTypes {
  type Connection = connectionTypes.Connection;

  type PathRequest = fileOpTypes.PathRequest;
}

export type { dirOpsTypes as default };
