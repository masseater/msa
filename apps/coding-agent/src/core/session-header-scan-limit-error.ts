import * as Data from "effect/Data";

import sessionManagerShared from "./session-manager-shared.ts";
const { MAX_SESSION_HEADER_SCAN_BYTES } = sessionManagerShared;

export default class SessionHeaderScanLimitError extends Data.TaggedError(
  "SessionHeaderScanLimitError",
)<{
  readonly message: string;
}> {
  constructor(filePath: string) {
    super({
      message: `Session header exceeds ${MAX_SESSION_HEADER_SCAN_BYTES}-byte scan limit: ${filePath}`,
    });
  }
}
