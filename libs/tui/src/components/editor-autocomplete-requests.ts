import { Effect } from "effect";

import type autocompleteTypes from "../autocomplete.types.ts";
import delay from "../delay.ts";
import type delayTypes from "../delay.types.ts";
import type editorAutocompleteRequestsTypes from "./editor-autocomplete-requests.types.ts";

const { runAfter } = delay;

interface RequestSnapshot {
  requestId: number;
  controller: AbortController;
  text: string;
  line: number;
  col: number;
}

export default class AutocompleteRequests {
  private readonly host: editorAutocompleteRequestsTypes.AutocompleteRequestHost;
  private abort: AbortController | undefined;
  private cancelDebounce: delayTypes.CancelDelay | undefined;
  private task: Promise<void> = Promise.resolve();
  private startToken = 0;
  private requestId = 0;

  constructor(host: editorAutocompleteRequestsTypes.AutocompleteRequestHost) {
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

  request(
    options: editorAutocompleteRequestsTypes.AutocompleteRequestOptions,
    debounceMs: number,
  ): void {
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

  private start(
    startToken: number,
    options: editorAutocompleteRequestsTypes.AutocompleteRequestOptions,
  ): Promise<void> {
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
          col: doc.state.cursorCol,
          controller,
          line: doc.state.cursorLine,
          requestId: ++this.requestId,
          text: doc.getText(),
        };
        yield* this.run(snapshot, options);
      }),
    );
    return this.task;
  }

  private run(
    snapshot: RequestSnapshot,
    options: editorAutocompleteRequestsTypes.AutocompleteRequestOptions,
  ): Effect.Effect<void> {
    const provider = this.host.provider();
    if (provider === undefined) return Effect.void;
    return Effect.promise(() => {
      const { state } = this.host.doc;
      return provider.getSuggestions(state.lines, state.cursorLine, state.cursorCol, {
        force: options.force,
        signal: snapshot.controller.signal,
      });
    }).pipe(Effect.map((suggestions) => this.receive(provider, suggestions, snapshot, options)));
  }

  private receive(
    provider: autocompleteTypes.AutocompleteProvider,
    suggestions: autocompleteTypes.AutocompleteSuggestions | null,
    snapshot: RequestSnapshot,
    options: editorAutocompleteRequestsTypes.AutocompleteRequestOptions,
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
