import { BOLD, DIM, RESET } from "./colors.ts";
import type { UiController } from "./controller.ts";

export const runSlashCommand = (request: {
  readonly ui: UiController;
  readonly command: string;
}): boolean => {
  const { ui, command } = request;
  switch (command) {
    case "/select":
      ui.selectDialog("Pick a color", ["Red", "Green", "Blue", "Yellow"], (value) =>
        ui.notice(
          value !== undefined && value.length > 0 ? `You picked: ${value}` : "Selection cancelled",
        ),
      );
      return true;
    case "/confirm":
      ui.selectDialog("Are you sure?", ["Yes", "No"], (value) =>
        ui.notice(`Confirmed: ${value === "Yes"}`),
      );
      return true;
    case "/input":
      ui.inputDialog("Enter your name", undefined, (value) =>
        ui.notice(
          value !== undefined && value.length > 0 ? `You entered: ${value}` : "Input cancelled",
        ),
      );
      return true;
    case "/editor":
      ui.inputDialog("Edit text", "Hello, world!", (value) =>
        ui.notice(
          value !== undefined && value.length > 0 ? `Submitted: ${value}` : "Editor cancelled",
        ),
      );
      return true;
    default:
      return false;
  }
};

export const showWelcome = (ui: UiController): void => {
  ui.outputLog.append(`${BOLD}RPC Chat${RESET}`);
  ui.outputLog.append(
    `${DIM}Type a message and press Enter. Esc to abort or exit. Ctrl+D to quit.${RESET}`,
  );
  ui.outputLog.append(`${DIM}Slash commands: /select /confirm /input /editor${RESET}`);
  ui.outputLog.append("");
};
