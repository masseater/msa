import { HYDRATION, type Hydration } from "./cell.ts";
import type { RemoteRef } from "./remote-ref.ts";
import type { Readable, StateEvent } from "./types.ts";

export class ViewReadable implements Readable<unknown> {
  readonly view: RemoteRef;
  readonly #name: string;
  readonly #values = new Set<(value: unknown) => void>();
  readonly #events = new Set<(event: StateEvent<unknown>) => void>();
  readonly #unseen = new Set<(event: StateEvent<unknown>) => void>();

  constructor(view: RemoteRef, name: string) {
    this.view = view;
    this.#name = name;
  }

  get value(): unknown {
    if (this.view.ended) throw this.view.terminalError();
    return this.view.binding.read(this.#name);
  }

  get [HYDRATION](): Hydration | undefined {
    const binding = this.view.binding;
    if (binding.hydrated) return undefined;
    return { hydrated: false, whenHydrated: () => binding.whenHydrated() };
  }

  subscribe(listener: (value: unknown) => void): () => void {
    this.#values.add(listener);
    this.#attach();
    if (this.#readable())
      this.#safe(() => listener(this.view.binding.members.get(this.#name)?.value));
    return () => this.#remove(this.#values, listener);
  }

  events(listener: (event: StateEvent<unknown>) => void): () => void {
    this.#events.add(listener);
    this.#attach();
    if (this.#readable()) {
      const value = this.view.binding.members.get(this.#name)?.value;
      this.#safe(() => listener({ type: "snap", value }));
    } else this.#unseen.add(listener);
    return () => {
      this.#unseen.delete(listener);
      this.#remove(this.#events, listener);
    };
  }

  deliver(event: StateEvent<unknown>): void {
    for (const listener of [...this.#events]) {
      if (!this.#unseen.delete(listener)) this.#safe(() => listener(event));
      else if (event.type !== "ops")
        this.#safe(() => listener({ type: "snap", value: event.value }));
    }
    for (const listener of [...this.#values]) this.#safe(() => listener(event.value));
  }

  stop(): void {
    this.#values.clear();
    this.#events.clear();
    this.#unseen.clear();
    this.view.binding.unlisten(this.#name, this);
  }

  #readable(): boolean {
    return !this.view.ended && this.view.binding.readable(this.#name);
  }

  #attach(): void {
    if (!this.view.ended) this.view.binding.listen(this.#name, this);
  }

  #remove<T>(set: Set<T>, listener: T): void {
    set.delete(listener);
    if (this.#values.size + this.#events.size === 0) this.view.binding.unlisten(this.#name, this);
  }

  #safe(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.view.binding.host.report(error);
    }
  }
}
