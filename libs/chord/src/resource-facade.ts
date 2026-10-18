import { notReady } from "./cell.ts";
import type { HostCore } from "./core.ts";
import type { Resource } from "./declare.ts";
import { facades, type ResourceImpl } from "./resource.ts";

export class ResourceFacade<T> implements Resource<T> {
  readonly #resource: ResourceImpl<T>;
  readonly #host: HostCore;

  constructor(resource: ResourceImpl<T>, host: HostCore) {
    this.#resource = resource;
    this.#host = host;
    facades.set(this, resource as ResourceImpl);
  }

  get key(): string {
    return this.#resource.key;
  }

  get value(): T {
    if (this.#host.inFactory > 0) throw notReady(`resource ${this.key} (inside a factory)`);
    return this.#resource.value;
  }
}
