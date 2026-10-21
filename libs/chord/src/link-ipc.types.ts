import type linkIpc from "./link-ipc.ts";

declare namespace linkIpcTypes {
  interface IpcChannel {
    readonly connected: boolean;
    send(message: unknown, callback?: (error: Error | null) => void): boolean;
    on(event: "message", listener: (message: unknown) => void): unknown;
    on(event: "disconnect", listener: () => void): unknown;
    off(event: "message", listener: (message: unknown) => void): unknown;
    off(event: "disconnect", listener: () => void): unknown;
  }

  type IpcLink = (typeof linkIpc.IpcLink)["prototype"];
}

export type { linkIpcTypes as default };
