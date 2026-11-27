function createTinyBmp1x1Red24bpp(): Buffer {
  const buffer = Buffer.alloc(58);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(1, 18);
  buffer.writeInt32LE(1, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(4, 34);
  buffer[56] = 0xff;
  return buffer;
}

const imageFixtureSupport = {
  createTinyBmp1x1Red24bpp,
};

export default imageFixtureSupport;
