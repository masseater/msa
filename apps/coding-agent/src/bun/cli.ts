import lightCommands from "../cli/light-commands.ts";
import nodeLlamaCppModule from "../core/platform/node/node-llama-cpp.ts";
import restoreSandboxEnvModule from "./restore-sandbox-env.ts";

const { bindingTestScript, runBindingTest } = nodeLlamaCppModule;
const { restoreSandboxEnv } = restoreSandboxEnvModule;

const startCli = () =>
  restoreSandboxEnv()
    .then(() => import("./runtime-setup.ts"))
    .then(({ default: runtimeSetup }) => {
      runtimeSetup.setupBunRuntime();
      return import("../cli/setup.ts");
    })
    .then(({ default: setup }) => {
      setup.setupCli();
      const args = process.argv.slice(2);
      return (
        lightCommands.runLightCommand(args) ??
        import("../main.ts").then(({ default: mainModule }) => mainModule.main(args))
      );
    });

const bindingTest = bindingTestScript(process.argv.slice(2));
void (bindingTest === undefined ? startCli() : runBindingTest(bindingTest));
