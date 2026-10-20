import declarations from "./declarations.ts";
import bridge from "./runtime/bridge.ts";
import host from "./runtime/host.ts";
import inline from "./runtime/inline.ts";
import preludeSource from "./runtime/prelude-source.ts";
import remoteModule from "./runtime/remote.ts";
import sandboxBase from "./runtime/sandbox-base.ts";
import schemaType from "./schema-type.ts";
import source from "./source.ts";

const codemode: {
  readonly CODEMODE_OPTIONS_PREFIX: typeof source.CODEMODE_OPTIONS_PREFIX;
  readonly CODEMODE_SOURCE_GRAMMAR: typeof source.CODEMODE_SOURCE_GRAMMAR;
  readonly CodemodeSandbox: typeof host.CodemodeSandbox;
  readonly CodemodeSandboxBase: typeof sandboxBase.CodemodeSandboxBase;
  readonly CodemodeSourceError: typeof source.CodemodeSourceError;
  readonly DEFAULT_INPUT_SCHEMA_MAX_CHARS: typeof declarations.DEFAULT_INPUT_SCHEMA_MAX_CHARS;
  readonly DEFAULT_INTERRUPT_BUDGET: typeof inline.DEFAULT_INTERRUPT_BUDGET;
  readonly InlineCodemodeSandbox: typeof inline.InlineCodemodeSandbox;
  readonly MAX_OUTPUT_CHARS: typeof preludeSource.MAX_OUTPUT_CHARS;
  readonly MAX_OUTPUT_ITEMS: typeof preludeSource.MAX_OUTPUT_ITEMS;
  readonly MAX_STORE_TOTAL_CHARS: typeof preludeSource.MAX_STORE_TOTAL_CHARS;
  readonly MAX_STORE_VALUE_CHARS: typeof preludeSource.MAX_STORE_VALUE_CHARS;
  readonly RemoteCodemodeSandbox: typeof remoteModule.RemoteCodemodeSandbox;
  readonly loadQuickJSWasm: typeof host.loadQuickJSWasm;
  readonly parseCodemodeSource: typeof source.parseCodemodeSource;
  readonly renderDeclarations: typeof declarations.renderDeclarations;
  readonly renderToolOutputType: typeof declarations.renderToolOutputType;
  readonly renderToolSample: typeof declarations.renderToolSample;
  readonly renderToolSignature: typeof declarations.renderToolSignature;
  readonly schemaToType: typeof schemaType.schemaToType;
  readonly schemaToTypeWithin: typeof schemaType.schemaToTypeWithin;
  readonly serveCodemodeRemote: typeof remoteModule.serveCodemodeRemote;
  readonly toCodemodeIdentifier: typeof bridge.toCodemodeIdentifier;
} = {
  CODEMODE_OPTIONS_PREFIX: source.CODEMODE_OPTIONS_PREFIX,
  CODEMODE_SOURCE_GRAMMAR: source.CODEMODE_SOURCE_GRAMMAR,
  CodemodeSandbox: host.CodemodeSandbox,
  CodemodeSandboxBase: sandboxBase.CodemodeSandboxBase,
  CodemodeSourceError: source.CodemodeSourceError,
  DEFAULT_INPUT_SCHEMA_MAX_CHARS: declarations.DEFAULT_INPUT_SCHEMA_MAX_CHARS,
  DEFAULT_INTERRUPT_BUDGET: inline.DEFAULT_INTERRUPT_BUDGET,
  InlineCodemodeSandbox: inline.InlineCodemodeSandbox,
  MAX_OUTPUT_CHARS: preludeSource.MAX_OUTPUT_CHARS,
  MAX_OUTPUT_ITEMS: preludeSource.MAX_OUTPUT_ITEMS,
  MAX_STORE_TOTAL_CHARS: preludeSource.MAX_STORE_TOTAL_CHARS,
  MAX_STORE_VALUE_CHARS: preludeSource.MAX_STORE_VALUE_CHARS,
  RemoteCodemodeSandbox: remoteModule.RemoteCodemodeSandbox,
  loadQuickJSWasm: host.loadQuickJSWasm,
  parseCodemodeSource: source.parseCodemodeSource,
  renderDeclarations: declarations.renderDeclarations,
  renderToolOutputType: declarations.renderToolOutputType,
  renderToolSample: declarations.renderToolSample,
  renderToolSignature: declarations.renderToolSignature,
  schemaToType: schemaType.schemaToType,
  schemaToTypeWithin: schemaType.schemaToTypeWithin,
  serveCodemodeRemote: remoteModule.serveCodemodeRemote,
  toCodemodeIdentifier: bridge.toCodemodeIdentifier,
};

export default codemode;
