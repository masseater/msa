import indexKit from "./index-kit.ts";
import json from "./json.ts";
import linkIpc from "./link-ipc.ts";
import linkMemory from "./link-memory.ts";
import linkPack from "./link-pack.ts";
import linkWebsocket from "./link-websocket.ts";
import registryModule from "./registry.ts";
import state from "./state.ts";
import websocket from "./websocket.ts";
import wire from "./wire.ts";

const {
  cell,
  contract,
  contractBuild,
  contractCompat,
  errors: errorsModule,
  host,
  hostTypes,
} = indexKit;

const chord = {
  Cell: cell.Cell,
  ChordError: errorsModule.ChordError,
  PACK_THRESHOLD: linkPack.PACK_THRESHOLD,
  PROTOCOL_VERSION: wire.PROTOCOL_VERSION,
  acceptWebSockets: websocket.acceptWebSockets,
  bind: contractCompat.bind,
  copyJson: json.copyJson,
  coverage: contractCompat.coverage,
  createHost: host.createHost,
  defineFacet: hostTypes.defineFacet,
  defineRegistry: registryModule.defineRegistry,
  forbidden: errorsModule.forbidden,
  hostFamily: contract.hostFamily,
  hostNamed: contract.hostNamed,
  inflateMessage: linkPack.inflateMessage,
  invalid: errorsModule.invalid,
  ipcLink: linkIpc.ipcLink,
  isChordError: errorsModule.isChordError,
  isJsonValue: json.isJsonValue,
  local: contractBuild.local,
  memoryLinkPair: linkMemory.memoryLinkPair,
  method: contract.method,
  opaque: contract.opaque,
  remote: contractBuild.remote,
  replicatedState: state.replicatedState,
  webSocketLink: linkWebsocket.webSocketLink,
};

export default chord;
