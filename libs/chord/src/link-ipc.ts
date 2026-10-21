import type compressionTypes from "./compression.types.ts";
import IpcLink from "./ipc-link.ts";
import type linkIpcTypes from "./link-ipc.types.ts";

const ipcLink = (
  channel: linkIpcTypes.IpcChannel,
  options?: compressionTypes.CompressionOptions,
): IpcLink => new IpcLink(channel, options);

const linkIpc = {
  IpcLink,
  ipcLink,
};

export default linkIpc;
