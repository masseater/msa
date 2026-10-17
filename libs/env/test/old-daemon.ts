const token = process.argv[process.argv.indexOf("--token") + 1];
process.stdout.write(`MSA-ENV ${token}\n`);

function send(type: number, id: number, json: Record<string, unknown>): void {
  const body = Buffer.from(JSON.stringify(json), "utf8");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(9 + body.length, 0);
  header.writeUInt8(type, 4);
  header.writeUInt32BE(id, 5);
  header.writeUInt32BE(body.length, 9);
  process.stdout.write(Buffer.concat([header, body]));
}

let buffered = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  buffered = Buffer.concat([buffered, chunk]);
  while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32BE(0)) {
    const length = buffered.readUInt32BE(0);
    const type = buffered.readUInt8(4);
    const id = buffered.readUInt32BE(5);
    const jsonLength = buffered.readUInt32BE(9);
    const json = JSON.parse(buffered.subarray(13, 13 + jsonLength).toString("utf8")) as {
      op?: string;
    };
    buffered = buffered.subarray(4 + length);
    if (type !== 1) continue;
    if (json.op === "hello") {
      send(2, id, {
        protocol: 1,
        version: "1.1.0",
        os: "linux",
        arch: "x86_64",
        home: "/",
        separator: "/",
        tmpdir: "/tmp",
        cwd: "/",
        driveCwds: {},
        pid: process.pid,
      });
    } else {
      send(3, id, { code: "EINVAL", message: `unknown operation ${json.op}` });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
