import { createReadStream, createWriteStream, unwatchFile, watch, watchFile } from "node:fs";

const nodeFs = {
  createReadStream,
  createWriteStream,
  unwatchFile,
  watch,
  watchFile,
};

export default nodeFs;
