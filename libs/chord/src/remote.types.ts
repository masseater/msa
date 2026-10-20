import type remoteTypesModule from "./remote-types.ts";
import type RemoteBindingClass from "./remote.ts";

declare namespace remoteTypes {
  type RemoteCall = remoteTypesModule.RemoteCall;

  type RemoteChannel = remoteTypesModule.RemoteChannel;

  type RemoteHost = remoteTypesModule.RemoteHost;

  type RemoteBinding = RemoteBindingClass;
}

export type { remoteTypes as default };
