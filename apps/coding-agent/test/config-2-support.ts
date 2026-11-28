function setExecPath(value: string): void {
  Object.defineProperty(process, "execPath", {
    configurable: true,
    value,
  });
}

function createFakeBunScript(bunBin: string): string {
  if (process.platform === "win32") {
    return `@echo off\r\nif "%1"=="pm" if "%2"=="bin" if "%3"=="-g" echo ${bunBin}\r\n`;
  }
  const escapedBunBin = bunBin.replaceAll("'", "'\\''");
  return `#!/bin/sh\nif [ "$1" = "pm" ] && [ "$2" = "bin" ] && [ "$3" = "-g" ]; then\n\tprintf '%s\\n' '${escapedBunBin}'\n\texit 0\nfi\nexit 1\n`;
}

const config2Support = {
  createFakeBunScript,
  setExecPath,
};

export default config2Support;
