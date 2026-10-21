import delay from "../delay.ts";
import type delayTypes from "../delay.types.ts";
import type tuiInterfaceTypes from "../tui-interface.types.ts";
import type loaderTypes from "./loader.types.ts";
import Text from "./text.ts";

const { runEvery } = delay;

const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_INTERVAL_MS = 80;

export default class Loader extends Text {
  private frames = [...DEFAULT_FRAMES];
  private intervalMs = DEFAULT_INTERVAL_MS;
  private currentFrame = 0;
  private cancelAnimation: delayTypes.CancelDelay | null = null;
  private ui: tuiInterfaceTypes.TUI | null = null;
  private renderIndicatorVerbatim = false;
  private spinnerColorFn: (str: string) => string;
  private messageColorFn: (str: string) => string;
  private message: string = "Loading...";

  constructor(
    ui: tuiInterfaceTypes.TUI,
    spinnerColorFn: (str: string) => string,
    messageColorFn: (str: string) => string,
    message: string = "Loading...",
    indicator?: loaderTypes.LoaderIndicatorOptions,
  ) {
    super("", 1, 0);
    this.ui = ui;
    this.spinnerColorFn = spinnerColorFn;
    this.messageColorFn = messageColorFn;
    this.message = message;
    this.setIndicator(indicator);
  }

  override render(width: number): string[] {
    return ["", ...super.render(width)];
  }

  start(): void {
    this.updateDisplay();
    this.restartAnimation();
  }

  stop(): void {
    if (this.cancelAnimation !== null) {
      this.cancelAnimation();
      this.cancelAnimation = null;
    }
  }

  setMessage(message: string): void {
    this.message = message;
    this.updateDisplay();
  }

  override invalidate(): void {
    super.invalidate();
    this.updateDisplay();
  }

  setIndicator(indicator?: loaderTypes.LoaderIndicatorOptions): void {
    this.renderIndicatorVerbatim = indicator !== undefined;
    this.frames = indicator?.frames === undefined ? [...DEFAULT_FRAMES] : [...indicator.frames];
    this.intervalMs =
      indicator?.intervalMs !== undefined && indicator.intervalMs > 0
        ? indicator.intervalMs
        : DEFAULT_INTERVAL_MS;
    this.currentFrame = 0;
    this.start();
  }

  private restartAnimation(): void {
    this.stop();
    if (this.frames.length <= 1) {
      return;
    }
    this.cancelAnimation = runEvery(this.intervalMs, () => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this.updateDisplay();
    });
  }

  protected getRenderedIndicator(): string {
    const frame = this.frames[this.currentFrame] ?? "";
    return this.renderIndicatorVerbatim ? frame : this.spinnerColorFn(frame);
  }

  private updateDisplay(): void {
    const renderedFrame = this.getRenderedIndicator();
    const indicator = renderedFrame.length > 0 ? `${renderedFrame} ` : "";
    this.setText(`${indicator}${this.messageColorFn(this.message)}`);
    if (this.ui !== null) {
      this.ui.requestRender();
    }
  }
}
