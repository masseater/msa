function rangeDecoder(): InstanceType<typeof TextDecoder> {
  return new TextDecoder("utf-8", { ignoreBOM: true });
}

function startsWithBom(firstBytes: Uint8Array): boolean {
  return firstBytes[0] === 0xef && firstBytes[1] === 0xbb && firstBytes[2] === 0xbf;
}

const decodeModule = {
  rangeDecoder,
  startsWithBom,
};

export default decodeModule;
