import type sandboxBase from "./sandbox-base.ts";

declare namespace sandboxBaseTypes {
  type CodemodeSandboxBase = (typeof sandboxBase.CodemodeSandboxBase)["prototype"];
}

export type { sandboxBaseTypes as default };
