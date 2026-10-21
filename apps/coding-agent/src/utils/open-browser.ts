import childProcess from "./child-process.ts";

const { spawnProcess } = childProcess;

function openBrowser(target: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", target]]
        : ["xdg-open", [target]];

  spawnProcess(cmd, args, { detached: true, stdio: "ignore" })
    .on("error", () => {})
    .unref();
}

const openBrowserModule = {
  openBrowser,
};

export default openBrowserModule;
