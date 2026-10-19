import { spawnProcess } from "./child-process.ts";

export function openBrowser(target: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", target]]
        : ["xdg-open", [target]];

  spawnProcess(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}
