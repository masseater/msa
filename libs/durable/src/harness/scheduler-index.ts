import type schedulerIndexTypes from "./scheduler-index.types.ts";
import schedulerRecords from "./scheduler-records.ts";
import SetMap from "./scheduler-setmap.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const { cancellationIntent, conversationNode, conversationOf, nodeOf, parentNode } =
  schedulerRecords;

export default class SchedulerIndex {
  readonly live = new Map<schedulerTypesModule.TaskId, schedulerTypesModule.AnyTaskRecord>();
  readonly edges = new Map<
    schedulerTypesModule.ConversationId,
    schedulerTypesModule.TaskId | null
  >();
  readonly settled = new Map<schedulerTypesModule.TaskId, schedulerTypesModule.TaskNode>();
  readonly dropQueue = new Set<schedulerTypesModule.Node>();
  readonly below = new SetMap<schedulerTypesModule.Node, schedulerTypesModule.Node>();
  readonly roots = new Set<schedulerTypesModule.ConversationId>();
  readonly unloaded = new Set<schedulerTypesModule.TaskId>();
  readonly intent = new Set<schedulerTypesModule.TaskId>();
  readonly runnable = new Set<schedulerTypesModule.TaskId>();
  readonly finalizeChecks = new Set<schedulerTypesModule.TaskId>();
  readonly waiters = new SetMap<schedulerTypesModule.TaskId, schedulerTypesModule.TaskId>();
  readonly failFastChecks = new Set<schedulerTypesModule.TaskId>();
  protected readonly hooks: schedulerIndexTypes.IndexHooks;

  constructor(hooks: schedulerIndexTypes.IndexHooks) {
    this.hooks = hooks;
  }

  setEdge(
    conversationId: schedulerTypesModule.ConversationId,
    owner: schedulerTypesModule.TaskId | null,
  ): void {
    this.edges.set(conversationId, owner);
    this.relist(conversationNode(conversationId));
    this.dropIfUnneeded(conversationNode(conversationId));
  }

  settle(id: schedulerTypesModule.TaskId, node: schedulerTypesModule.TaskNode): void {
    this.settled.set(id, node);
    this.unloaded.add(id);
    this.relist(id);
    this.dropIfUnneeded(id);
  }

  dropIfUnneeded(node: schedulerTypesModule.Node): void {
    if (typeof node !== "string" && this.live.has(node)) return;
    if (this.below.has(node)) return;
    this.dropQueue.add(node);
    this.hooks.scheduleSweep();
  }

  sweep(): void {
    for (const node of this.dropQueue) {
      if (this.below.has(node)) continue;
      if (typeof node === "string") {
        this.edges.delete(conversationOf(node));
        this.roots.delete(conversationOf(node));
      } else if (!this.live.has(node)) {
        this.settled.delete(node);
        this.unloaded.delete(node);
      }
    }
    this.dropQueue.clear();
  }

  track(
    previous: schedulerTypesModule.AnyTaskRecord | undefined,
    record: schedulerTypesModule.AnyTaskRecord,
  ): void {
    const id = record.id;
    if (previous?.state.status === "waiting")
      for (const on of previous.state.on) this.waiters.deleteFrom(on, id);
    if (record.state.status === "terminal") {
      this.#trackTerminal(record);
      return;
    }
    this.live.set(id, record);
    if (previous === undefined) {
      if (!this.known(parentNode(record))) this.unloaded.add(id);
      this.relist(id);
    }
    if (cancellationIntent(record)) this.intent.add(id);
    else this.intent.delete(id);
    if (record.state.status === "completing") {
      this.runnable.delete(id);
      this.finalizeChecks.add(id);
    } else {
      this.runnable.add(id);
    }
    if (record.state.status === "waiting")
      for (const on of record.state.on) this.waiters.addTo(on, id);
  }

  #trackTerminal(record: schedulerTypesModule.AnyTaskRecord): void {
    const id = record.id;
    const node = nodeOf(record);
    this.live.delete(id);
    this.intent.delete(id);
    this.runnable.delete(id);
    this.finalizeChecks.delete(id);
    this.settled.set(id, node);
    this.release(node);
    for (const waiter of this.waiters.get(id) ?? []) this.runnable.add(waiter);
    this.relist(id);
    this.dropIfUnneeded(id);
  }

  release(
    node: schedulerTypesModule.TaskNode,
    overlay?: schedulerTypesModule.Overlay,
  ): schedulerTypesModule.AnyTaskRecord | undefined {
    const above = this.nearestLiveAbove(node, overlay);
    if (above?.state.status === "completing") this.finalizeChecks.add(above.id);
    else if (above?.abortRequested === true) this.runnable.add(above.id);
    return above;
  }

  #parent(node: schedulerTypesModule.Node): schedulerTypesModule.Node | null | undefined | false {
    if (typeof node === "string") return this.edges.get(conversationOf(node));
    const known = this.live.get(node) ?? this.settled.get(node);
    return known === undefined ? false : parentNode(known);
  }

  relist(start: schedulerTypesModule.Node): void {
    let node: schedulerTypesModule.Node = start;
    for (;;) {
      const needed = (typeof node !== "string" && this.live.has(node)) || this.below.has(node);
      const parent = this.#parent(node);
      if (parent === false || parent === undefined) return;
      if (parent === null) {
        const root = conversationOf(node as `c${number}`);
        if (needed) this.roots.add(root);
        else this.roots.delete(root);
        return;
      }
      if ((this.below.get(parent)?.has(node) === true) === needed) return;
      if (!this.#link(parent, node, needed)) return;
      node = parent;
    }
  }

  #link(
    parent: schedulerTypesModule.Node,
    node: schedulerTypesModule.Node,
    needed: boolean,
  ): boolean {
    if (needed) {
      const first = !this.below.has(parent);
      this.below.addTo(parent, node);
      return first;
    }
    this.below.deleteFrom(parent, node);
    if (this.below.has(parent)) return false;
    this.dropIfUnneeded(parent);
    return true;
  }

  nearestLiveAbove(
    node: schedulerTypesModule.TaskNode,
    overlay?: schedulerTypesModule.Overlay,
  ): schedulerTypesModule.AnyTaskRecord | undefined {
    for (let current = node; !current.background;) {
      const owner = current.owner ?? this.edge(current.conversationId, overlay);
      if (owner === undefined || owner === null) return undefined;
      const record = overlay?.tasks.get(owner) ?? this.live.get(owner);
      if (record !== undefined && record.state.status !== "terminal") return record;
      const above = record ?? this.settled.get(owner);
      if (above === undefined) return undefined;
      current = above;
    }
    return undefined;
  }

  known(node: schedulerTypesModule.Node): boolean {
    if (typeof node !== "string") {
      return (this.live.has(node) || this.settled.has(node)) && !this.unloaded.has(node);
    }
    const owner = this.edges.get(conversationOf(node));
    return owner === null || (owner !== undefined && this.known(owner));
  }

  edge(
    id: schedulerTypesModule.ConversationId,
    overlay?: schedulerTypesModule.Overlay,
  ): schedulerTypesModule.TaskId | null | undefined {
    return overlay?.edges.has(id) === true ? overlay.edges.get(id) : this.edges.get(id);
  }

  node(
    id: schedulerTypesModule.TaskId,
    overlay?: schedulerTypesModule.Overlay,
  ): schedulerTypesModule.TaskNode | undefined {
    return overlay?.tasks.get(id) ?? this.live.get(id) ?? this.settled.get(id);
  }

  get indexSizes(): schedulerIndexTypes.IndexSizes {
    let below = 0;
    for (const children of this.below.values()) below += children.size;
    return {
      below,
      dropQueue: this.dropQueue.size,
      edges: this.edges.size,
      live: this.live.size,
      roots: this.roots.size,
      settled: this.settled.size,
      unloaded: this.unloaded.size,
    };
  }
}
