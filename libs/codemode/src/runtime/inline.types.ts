import type inline from "./inline.ts";
import type protocolTypes from "./protocol.ts";

declare namespace inlineTypes {
  type InlineCodemodeSandboxOptions = protocolTypes.InlineCodemodeSandboxOptions;

  type InlineCodemodeSandbox = (typeof inline.InlineCodemodeSandbox)["prototype"];
}

export type { inlineTypes as default };
