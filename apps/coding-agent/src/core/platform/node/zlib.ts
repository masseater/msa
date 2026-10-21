import { crc32, deflateRawSync } from "node:zlib";

const nodeZlib = {
  crc32,
  deflateRawSync,
};

export default nodeZlib;
