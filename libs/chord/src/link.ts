import linkIpc from "./link-ipc.ts";
import linkMemory from "./link-memory.ts";
import linkPack from "./link-pack.ts";
import linkWebsocket from "./link-websocket.ts";

const link = {
  IpcLink: linkIpc.IpcLink,
  MemoryLink: linkMemory.MemoryLink,
  PACK_THRESHOLD: linkPack.PACK_THRESHOLD,
  Packed: linkPack.Packed,
  WebSocketLink: linkWebsocket.WebSocketLink,
  inflateMessage: linkPack.inflateMessage,
  ipcLink: linkIpc.ipcLink,
  memoryLinkPair: linkMemory.memoryLinkPair,
  unpack: linkPack.unpack,
  webSocketLink: linkWebsocket.webSocketLink,
};

export default link;
