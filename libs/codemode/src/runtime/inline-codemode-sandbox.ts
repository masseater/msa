import inlineModule from "./inline.ts";
import type protocolTypes from "./protocol.ts";
import sandboxBase from "./sandbox-base.ts";

const { CodemodeSandboxBase } = sandboxBase;

export default class InlineCodemodeSandbox extends CodemodeSandboxBase {
  constructor(options: protocolTypes.InlineCodemodeSandboxOptions) {
    super(
      options,
      inlineModule.inlineLauncher({ interruptBudget: options.interruptBudget, wasm: options.wasm }),
    );
  }
}
