import { EventEmitter } from "node:events";

const fakeOutput = () => {
  const output = new EventEmitter();
  return Object.assign(output, {
    end: () => output.emit("end"),
    write: (chunk: string) => output.emit("data", Buffer.from(chunk)),
  });
};
export default class MockSpawnedProcess extends EventEmitter {
  stdout = fakeOutput();
  stderr = fakeOutput();

  kill(): boolean {
    this.emit("close", null, "SIGTERM");
    return true;
  }
}
