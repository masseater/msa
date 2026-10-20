import cell from "./cell.ts";
import type coreTypes from "./core.types.ts";
import type declareTypes from "./declare.ts";
import resourceModule from "./resource.ts";
import type resourceTypes from "./resource.types.ts";

const { facades } = resourceModule;
const { notReady } = cell;

export default class ResourceFacade<T> implements declareTypes.Resource<T> {
  readonly #resource: resourceTypes.ResourceImpl<T>;
  readonly #host: coreTypes.HostCore;

  constructor(resource: resourceTypes.ResourceImpl<T>, host: coreTypes.HostCore) {
    this.#resource = resource;
    this.#host = host;
    facades.set(this, resource as resourceTypes.ResourceImpl);
  }

  get key(): string {
    return this.#resource.key;
  }

  get value(): T {
    if (this.#host.inFactory > 0) throw notReady(`resource ${this.key} (inside a factory)`);
    return this.#resource.value;
  }
}
