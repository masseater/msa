import type declarationsTypes from "./declarations.types.ts";
import type hostTypes from "./runtime/host.types.ts";
import type inlineTypes from "./runtime/inline.types.ts";
import type protocolTypes from "./runtime/protocol.ts";
import type remoteTypes from "./runtime/remote.types.ts";
import type sandboxBaseTypes from "./runtime/sandbox-base.types.ts";
import type sourceTypes from "./source.types.ts";
import type typesModule from "./types.ts";

declare namespace codemodeTypes {
  type RenderDeclarationsOptions = declarationsTypes.RenderDeclarationsOptions;

  type RenderToolOptions = declarationsTypes.RenderToolOptions;

  type InlineCodemodeSandboxOptions = protocolTypes.InlineCodemodeSandboxOptions;

  type CodemodeRemote = protocolTypes.CodemodeRemote;

  type CodemodeRemoteExchange = protocolTypes.CodemodeRemoteExchange;

  type CodemodeRemoteMessage = protocolTypes.CodemodeRemoteMessage;

  type CodemodeRemoteReply = protocolTypes.CodemodeRemoteReply;

  type CodemodeRemoteRequest = protocolTypes.CodemodeRemoteRequest;

  type CodemodeServeOptions = protocolTypes.CodemodeServeOptions;

  type RemoteCodemodeSandboxOptions = protocolTypes.RemoteCodemodeSandboxOptions;

  type CodemodeSourceOptions = sourceTypes.CodemodeSourceOptions;

  type ParsedCodemodeSource = sourceTypes.ParsedCodemodeSource;

  type CodemodeCall = typesModule.CodemodeCall;

  type CodemodeCallStatus = typesModule.CodemodeCallStatus;

  type CodemodeDeclaredGlobal = typesModule.CodemodeDeclaredGlobal;

  type CodemodeDeclaredTool = typesModule.CodemodeDeclaredTool;

  type CodemodeDuring = typesModule.CodemodeDuring;

  type CodemodeError = typesModule.CodemodeError;

  type CodemodeErrorKind = typesModule.CodemodeErrorKind;

  type CodemodeExecuteOptions = typesModule.CodemodeExecuteOptions;

  type CodemodeHostCall = typesModule.CodemodeHostCall;

  type CodemodeJsonSchema = typesModule.CodemodeJsonSchema;

  type CodemodeOutcome = typesModule.CodemodeOutcome;

  type CodemodeOutputItem = typesModule.CodemodeOutputItem;

  type CodemodeResult = typesModule.CodemodeResult;

  type CodemodeRun = typesModule.CodemodeRun;

  type CodemodeRunOptions = typesModule.CodemodeRunOptions;

  type CodemodeSandboxBaseOptions = typesModule.CodemodeSandboxBaseOptions;

  type CodemodeSandboxOptions = typesModule.CodemodeSandboxOptions;

  type CodemodeStoreWrites = typesModule.CodemodeStoreWrites;

  type CodemodeTool = typesModule.CodemodeTool;

  type CodemodeToolContext = typesModule.CodemodeToolContext;

  type CodemodeWasmModule = typesModule.CodemodeWasmModule;

  type CodemodeSandboxBase = sandboxBaseTypes.CodemodeSandboxBase;

  type CodemodeSandbox = hostTypes.CodemodeSandbox;

  type InlineCodemodeSandbox = inlineTypes.InlineCodemodeSandbox;

  type RemoteCodemodeSandbox = remoteTypes.RemoteCodemodeSandbox;

  type CodemodeSourceError = sourceTypes.CodemodeSourceError;
}

export type { codemodeTypes as default };
