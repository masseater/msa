import { getKeybindings } from "../keybindings.ts";
import { Loader } from "./loader.ts";

/**
 * Loader that can be cancelled with Escape.
 * Extends Loader with an AbortSignal for cancelling async operations.
 *
 * @example
 * const loader = new CancellableLoader(tui, cyan, dim, "Working...");
 * loader.onAbort = () => done(null);
 * doWork(loader.signal).then(done);
 */
export class CancellableLoader extends Loader {
  private abortController = new AbortController();

  /** Called when user presses Escape */
  onAbort?: () => void;

  /**
   * AbortSignal that is aborted when user presses Escape
   *
   * @returns {AbortSignal} The signal aborted on Escape.
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get aborted(): boolean {
    return this.abortController.signal.aborted;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.cancel")) {
      this.abortController.abort();
      this.onAbort?.();
    }
  }

  dispose(): void {
    this.stop();
  }
}
