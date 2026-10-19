import { restoreSandboxEnv } from "./restore-sandbox-env.ts";

restoreSandboxEnv();
const { setupBunRuntime } = await import("./runtime-setup.ts");
setupBunRuntime();
const { setupCli } = await import("../cli/setup.ts");
const { main } = await import("../main.ts");
setupCli();
main(process.argv.slice(2));
