function runLightCommand(args: readonly string[]): Promise<void> | undefined {
  if (args[0] !== "squash-message") return undefined;
  return import("../main/run-squash-message.ts").then(({ default: command }) =>
    command.runSquashMessage(args.slice(1)),
  );
}

const lightCommands = { runLightCommand };

export default lightCommands;
