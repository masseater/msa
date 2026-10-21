import bridge from "./runtime/bridge.ts";
import inline from "./runtime/inline.ts";
import preludeSource from "./runtime/prelude-source.ts";
import remoteModule from "./runtime/remote.ts";
import sandboxBase from "./runtime/sandbox-base.ts";

const portable = {
  CodemodeSandboxBase: sandboxBase.CodemodeSandboxBase,
  DEFAULT_INTERRUPT_BUDGET: inline.DEFAULT_INTERRUPT_BUDGET,
  InlineCodemodeSandbox: inline.InlineCodemodeSandbox,
  MAX_OUTPUT_CHARS: preludeSource.MAX_OUTPUT_CHARS,
  MAX_OUTPUT_ITEMS: preludeSource.MAX_OUTPUT_ITEMS,
  MAX_STORE_TOTAL_CHARS: preludeSource.MAX_STORE_TOTAL_CHARS,
  MAX_STORE_VALUE_CHARS: preludeSource.MAX_STORE_VALUE_CHARS,
  RemoteCodemodeSandbox: remoteModule.RemoteCodemodeSandbox,
  serveCodemodeRemote: remoteModule.serveCodemodeRemote,
  toCodemodeIdentifier: bridge.toCodemodeIdentifier,
};

export default portable;
