function setStdoutIsTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

const stdoutTtySupport = {
  setStdoutIsTTY,
};

export default stdoutTtySupport;
