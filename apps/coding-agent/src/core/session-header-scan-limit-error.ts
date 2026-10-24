import * as Schema from "effect/Schema";

import sessionManagerShared from "./session-manager-shared.ts";
const { MAX_SESSION_HEADER_SCAN_BYTES } = sessionManagerShared;

export default class SessionHeaderScanLimitError extends Schema.TaggedError<
  SessionHeaderScanLimitError,
  { readonly brand: unique symbol }
>()("SessionHeaderScanLimitError", { message: Schema.String }) {
  static create(filePath: string): SessionHeaderScanLimitError {
    return SessionHeaderScanLimitError.make({
      message: `Session header exceeds ${MAX_SESSION_HEADER_SCAN_BYTES}-byte scan limit: ${filePath}`,
    });
  }
}
