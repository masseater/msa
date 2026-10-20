import type cloudflare from "./cloudflare.ts";
import type inlineTypes from "./runtime/inline.types.ts";
import type protocolTypes from "./runtime/protocol.ts";
import type remoteTypes from "./runtime/remote.types.ts";
import type sandboxBaseTypes from "./runtime/sandbox-base.types.ts";
import type typesModule from "./types.ts";

declare namespace cloudflareTypes {
  type InlineCodemodeSandboxOptions = protocolTypes.InlineCodemodeSandboxOptions;

  type HostToWorkerMessage = protocolTypes.HostToWorkerMessage;

  type VmStartData = protocolTypes.VmStartData;

  type WorkerToHostMessage = protocolTypes.WorkerToHostMessage;

  type CodemodeRemote = protocolTypes.CodemodeRemote;

  type CodemodeRemoteExchange = protocolTypes.CodemodeRemoteExchange;

  type CodemodeRemoteMessage = protocolTypes.CodemodeRemoteMessage;

  type CodemodeRemoteReply = protocolTypes.CodemodeRemoteReply;

  type CodemodeRemoteRequest = protocolTypes.CodemodeRemoteRequest;

  type CodemodeServeOptions = protocolTypes.CodemodeServeOptions;

  type RemoteCodemodeSandboxOptions = protocolTypes.RemoteCodemodeSandboxOptions;

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

  type CodemodeStoreWrites = typesModule.CodemodeStoreWrites;

  type CodemodeTool = typesModule.CodemodeTool;

  type CodemodeToolContext = typesModule.CodemodeToolContext;

  type CodemodeWasmModule = typesModule.CodemodeWasmModule;

  type CodemodeSandboxBase = sandboxBaseTypes.CodemodeSandboxBase;

  type InlineCodemodeSandbox = inlineTypes.InlineCodemodeSandbox;

  type RemoteCodemodeSandbox = remoteTypes.RemoteCodemodeSandbox;

  type CodemodeSandboxDurableObject<Env = unknown> = InstanceType<
    typeof cloudflare.CodemodeSandboxDurableObject<Env>
  >;
}

export type { cloudflareTypes as default };
