import lightCommands from "./cli/light-commands.ts";
import setup from "./cli/setup.ts";

const { runLightCommand } = lightCommands;
const { setupCli } = setup;

setupCli();
const args = process.argv.slice(2);
void (
  runLightCommand(args) ??
  import("./main.ts").then(({ default: mainModule }) => mainModule.main(args))
);
