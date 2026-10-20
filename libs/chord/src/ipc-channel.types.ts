import type StreamChannelClass from "./ipc-channel.ts";

declare namespace ipcChannelTypes {
  type StreamChannel = StreamChannelClass;
}

export type { ipcChannelTypes as default };
