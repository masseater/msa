import IpcLink from "./ipc-link.ts";
import type linkIpcTypes from "./link-ipc.types.ts";

const ipcLink = (channel: linkIpcTypes.IpcChannel): IpcLink => new IpcLink(channel);

const linkIpc = {
  IpcLink,
  ipcLink,
};

export default linkIpc;
