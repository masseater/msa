import type InteractiveMode from "../interactive-mode.ts";
import BackgroundChecks from "./background-checks.ts";
import CrashHandling from "./crash-handling.ts";
import FatalErrorHandler from "./fatal-errors.ts";
import ModeRunLoop from "./run-loop.ts";
import ScreenRenderer from "./screen.ts";
import SessionEventRouter from "./session-events.ts";
import ModeShutdown from "./shutdown.ts";
import StartupHeader from "./startup-header.ts";
import ModeStartup from "./startup.ts";

export default class ModeLifecycle {
  readonly startupHeader: StartupHeader;
  readonly fatalErrors: FatalErrorHandler;
  readonly backgroundChecks: BackgroundChecks;
  readonly events: SessionEventRouter;
  readonly startup: ModeStartup;
  readonly runLoop: ModeRunLoop;
  readonly shutdown: ModeShutdown;
  readonly crash: CrashHandling;
  readonly screen: ScreenRenderer;

  constructor(mode: InteractiveMode) {
    this.startupHeader = new StartupHeader(mode);
    this.fatalErrors = new FatalErrorHandler(mode);
    this.backgroundChecks = new BackgroundChecks(mode);
    this.events = new SessionEventRouter(mode);
    this.startup = new ModeStartup(mode);
    this.runLoop = new ModeRunLoop(mode);
    this.shutdown = new ModeShutdown(mode);
    this.crash = new CrashHandling(mode);
    this.screen = new ScreenRenderer(mode);
  }
}
