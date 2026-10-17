import { Effect } from "effect";

import type { AutocompleteProvider, AutocompleteSuggestions } from "../autocomplete.ts";
import { type CancelDelay, runAfter } from "../delay.ts";
import type { EditorDocument } from "./editor-document.ts";

export interface AutocompleteRequestOptions {
  force: boolean;
  explicitTab: boolean;
}

export interface AutocompleteRequestHost {
  readonly doc: EditorDocument;
  provider(): AutocompleteProvider | undefined;
  deliver(
    provider: AutocompleteProvider,
    suggestions: AutocompleteSuggestions | null,
    options: AutocompleteRequestOptions,
  ): void;
}

interface RequestSnapshot {
  requestId: number;
  controller: AbortController;
  text: string;
  line: number;
  col: number;
}

export class AutocompleteRequests {
  private readonly host: AutocompleteRequestHost;
  private abort: AbortController | undefined;
  private cancelDebounce: CancelDelay | undefined;
  private task: Promise<void> = Promise.resolve();
  private startToken = 0;
  private requestId = 0;

  constructor(host: AutocompleteRequestHost) {
    this.host = host;
  }

  cancel(): void {
    this.startToken += 1;
    if (this.cancelDebounce !== undefined) {
      this.cancelDebounce();
      this.cancelDebounce = undefined;
    }
    this.abort?.abort();
    this.abort = undefined;
  }

  request(options: AutocompleteRequestOptions, debounceMs: number): void {
    this.cancel();
    const startToken = ++this.startToken;
    if (debounceMs > 0) {
      this.cancelDebounce = runAfter(debounceMs, () => {
        this.cancelDebounce = undefined;
        void this.start(startToken, options);
      });
      return;
    }
    void this.start(startToken, options);
  }

  private start(startToken: number, options: AutocompleteRequestOptions): Promise<void> {
    const previousTask = this.task;
    const controller = new AbortController();
    this.task = Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        yield* Effect.promise(() => previousTask);
        if (startToken !== this.startToken || this.host.provider() === undefined) {
          return;
        }
        this.abort = controller;
        const { doc } = this.host;
        const snapshot: RequestSnapshot = {
          requestId: ++this.requestId,
          controller,
          text: doc.getText(),
          line: doc.state.cursorLine,
          col: doc.state.cursorCol,
        };
        yield* this.run(snapshot, options);
      }),
    );
    return this.task;
  }

  private run(snapshot: RequestSnapshot, options: AutocompleteRequestOptions): Effect.Effect<void> {
    const provider = this.host.provider();
    if (provider === undefined) return Effect.void;
    return Effect.promise(() => {
      const { state } = this.host.doc;
      return provider.getSuggestions(state.lines, state.cursorLine, state.cursorCol, {
        signal: snapshot.controller.signal,
        force: options.force,
      });
    }).pipe(Effect.map((suggestions) => this.receive(provider, suggestions, snapshot, options)));
  }

  private receive(
    provider: AutocompleteProvider,
    suggestions: AutocompleteSuggestions | null,
    snapshot: RequestSnapshot,
    options: AutocompleteRequestOptions,
  ): void {
    if (!this.isCurrent(snapshot)) return;
    this.abort = undefined;
    this.host.deliver(provider, suggestions, options);
  }

  private isCurrent(snapshot: RequestSnapshot): boolean {
    const { doc } = this.host;
    return (
      !snapshot.controller.signal.aborted &&
      snapshot.requestId === this.requestId &&
      doc.getText() === snapshot.text &&
      doc.state.cursorLine === snapshot.line &&
      doc.state.cursorCol === snapshot.col
    );
  }
}
