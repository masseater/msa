import { deflateRawSync, inflateRawSync } from "node:zlib";

import type compressionTypes from "./compression.types.ts";

const zlibCompression: compressionTypes.Compression = {
  deflateRaw: (text) => deflateRawSync(text, { level: 1 }),
  inflateRaw: (bytes) => inflateRawSync(bytes).toString("utf8"),
};

export default zlibCompression;
