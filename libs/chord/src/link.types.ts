import type linkBaseTypes from "./link-base.types.ts";
import type linkIpcTypes from "./link-ipc.types.ts";
import type linkMemoryTypes from "./link-memory.types.ts";
import type linkPackTypes from "./link-pack.types.ts";
import type linkWebsocketTypes from "./link-websocket.types.ts";

declare namespace linkTypes {
  type Link = linkBaseTypes.Link;

  type IpcChannel = linkIpcTypes.IpcChannel;

  type WebSocketLike = linkWebsocketTypes.WebSocketLike;

  type WebSocketLinkOptions = linkWebsocketTypes.WebSocketLinkOptions;

  type IpcLink = linkIpcTypes.IpcLink;

  type MemoryLink = linkMemoryTypes.MemoryLink;

  type Packed = linkPackTypes.Packed;

  type WebSocketLink = linkWebsocketTypes.WebSocketLink;
}

export type { linkTypes as default };
