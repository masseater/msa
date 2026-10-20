import type InteractiveMode from "../interactive-mode.ts";
import BuiltinCommandRouter from "./command-router.ts";
import DebugCommand from "./debug-command.ts";
import EasterEggCommands from "./easter-eggs.ts";
import InfoCommands from "./info-commands.ts";
import ReloadBlocker from "./reload-blocker.ts";
import ReloadCommand from "./reload-command.ts";
import SessionCommands from "./session-commands.ts";
import SessionImport from "./session-import.ts";
import SessionInfoCommand from "./session-info-command.ts";

export default class ModeCommands {
  readonly reloadBlocker: ReloadBlocker;
  readonly importer: SessionImport;
  readonly sessionInfo: SessionInfoCommand;
  readonly debug: DebugCommand;
  readonly easterEggs: EasterEggCommands;
  readonly router: BuiltinCommandRouter;
  readonly session: SessionCommands;
  readonly info: InfoCommands;
  readonly reload: ReloadCommand;

  constructor(mode: InteractiveMode) {
    this.reloadBlocker = new ReloadBlocker(mode);
    this.importer = new SessionImport(mode);
    this.sessionInfo = new SessionInfoCommand(mode);
    this.debug = new DebugCommand(mode);
    this.easterEggs = new EasterEggCommands(mode);
    this.router = new BuiltinCommandRouter(mode);
    this.session = new SessionCommands(mode);
    this.info = new InfoCommands(mode);
    this.reload = new ReloadCommand(mode);
  }
}
