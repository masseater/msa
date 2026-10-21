function setExecPath(value: string): void {
  Object.defineProperty(process, "execPath", {
    configurable: true,
    value,
  });
}

const config2Support = {
  setExecPath,
};

export default config2Support;
