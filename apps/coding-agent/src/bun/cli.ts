import restoreSandboxEnvModule from "./restore-sandbox-env.ts";

const { restoreSandboxEnv } = restoreSandboxEnvModule;

restoreSandboxEnv();
void import("./runtime-setup.ts")
  .then(({ default: runtimeSetup }) => {
    runtimeSetup.setupBunRuntime();
    return import("../cli/setup.ts");
  })
  .then(({ default: setup }) =>
    import("../main.ts").then(({ default: mainModule }) => ({ mainModule, setup })),
  )
  .then(({ mainModule, setup }) => {
    setup.setupCli();
    return mainModule.main(process.argv.slice(2));
  });
