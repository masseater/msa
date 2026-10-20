import inlineModule from "./inline.ts";
import type protocolTypes from "./protocol.ts";
import sandboxBase from "./sandbox-base.ts";

export default class InlineCodemodeSandbox extends sandboxBase.CodemodeSandboxBase {
  constructor(options: protocolTypes.InlineCodemodeSandboxOptions) {
    super(
      options,
      inlineModule.inlineLauncher({ interruptBudget: options.interruptBudget, wasm: options.wasm }),
    );
  }
}
