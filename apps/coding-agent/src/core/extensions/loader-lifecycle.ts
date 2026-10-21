import type extensionsTypesTypes from "./types.types.ts";

type LoadState = "loading" | "active" | "failed";

export default class ExtensionApiLifecycle {
  readonly pendingFlagValues = new Map<string, boolean | string>();
  readonly loadingUnsubscribers: Array<() => void> = [];
  private readonly pendingRuntimeChanges: Array<() => void> = [];
  private state: LoadState = "loading";
  private readonly runtime: extensionsTypesTypes.ExtensionRuntime;

  constructor(runtime: extensionsTypesTypes.ExtensionRuntime) {
    this.runtime = runtime;
  }

  isLoading(): boolean {
    return this.state === "loading";
  }

  isFailed(): boolean {
    return this.state === "failed";
  }

  applyRuntimeChange(change: () => void): void {
    if (this.state === "loading") this.pendingRuntimeChanges.push(change);
    else change();
  }

  commit(): void {
    if (this.state !== "loading") return;
    this.runtime.assertActive();
    for (const [name, value] of this.pendingFlagValues) {
      if (!this.runtime.flagValues.has(name)) this.runtime.flagValues.set(name, value);
    }
    for (const apply of this.pendingRuntimeChanges) apply();
    this.state = "active";
    this.clearPending();
  }

  discard(): void {
    if (this.state !== "loading") return;
    this.state = "failed";
    for (const unsubscribe of this.loadingUnsubscribers) unsubscribe();
    this.clearPending();
  }

  private clearPending(): void {
    this.pendingFlagValues.clear();
    this.pendingRuntimeChanges.length = 0;
    this.loadingUnsubscribers.length = 0;
  }
}
