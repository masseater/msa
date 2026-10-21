import type protocolTypes from "./protocol.ts";
import type remoteModule from "./remote.ts";

declare namespace remoteTypes {
  type CodemodeRemote = protocolTypes.CodemodeRemote;

  type CodemodeRemoteExchange = protocolTypes.CodemodeRemoteExchange;

  type CodemodeRemoteMessage = protocolTypes.CodemodeRemoteMessage;

  type CodemodeRemoteReply = protocolTypes.CodemodeRemoteReply;

  type CodemodeRemoteRequest = protocolTypes.CodemodeRemoteRequest;

  type CodemodeServeOptions = protocolTypes.CodemodeServeOptions;

  type RemoteCodemodeSandboxOptions = protocolTypes.RemoteCodemodeSandboxOptions;

  type RemoteCodemodeSandbox = (typeof remoteModule.RemoteCodemodeSandbox)["prototype"];
}

export type { remoteTypes as default };
