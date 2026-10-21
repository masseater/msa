import SchedulerIndex from "./scheduler-index.ts";
import schedulerRecords from "./scheduler-records.ts";
import SetMap from "./scheduler-setmap.ts";
import type schedulerSetmapTypes from "./scheduler-setmap.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const { cancellationIntent, conversationNode, conversationOf, parentNode, parentOf } =
  schedulerRecords;

type OwnedOptions = {
  readonly overlay?: schedulerTypesModule.Overlay;
  readonly first?: boolean;
  readonly done?: ReadonlySet<schedulerTypesModule.TaskId>;
};

export default class SchedulerGraph extends SchedulerIndex {
  *above(
    start: schedulerTypesModule.Up,
    overlay?: schedulerTypesModule.Overlay,
  ): Generator<schedulerTypesModule.Step> {
    let at: schedulerTypesModule.Up | undefined = start;
    while (at !== undefined) {
      if ("task" in at) {
        const node = this.node(at.task, overlay);
        if (node === undefined) {
          yield { unknown: true };
          return;
        }
        yield { node, task: at.task };
        at = parentOf(node);
      } else {
        yield { conversation: at.conversation };
        const edge = this.edge(at.conversation, overlay);
        if (edge === undefined) {
          yield { unknown: true };
          return;
        }
        at = edge === null ? undefined : { task: edge };
      }
    }
  }

  *walkDown(
    start: schedulerTypesModule.Node,
    options: schedulerTypesModule.WalkOptions = {},
  ): Generator<schedulerTypesModule.Walked> {
    const { overlay, crossBackground = false, enter } = options;
    const links = overlay === undefined ? undefined : this.links(overlay);
    const pending: schedulerTypesModule.Node[] = [start];
    for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
      for (const children of [this.below.get(at), links?.get(at)]) {
        for (const child of children ?? []) {
          if (typeof child === "string") {
            pending.push(child);
            continue;
          }
          const found = this.#walked(child, overlay);
          if (found === undefined) continue;
          yield found;
          if ((crossBackground || !found.node.background) && (enter === undefined || enter(child)))
            pending.push(child);
        }
      }
    }
  }

  #walked(
    child: schedulerTypesModule.TaskId,
    overlay: schedulerTypesModule.Overlay | undefined,
  ): schedulerTypesModule.Walked | undefined {
    const record = overlay?.tasks.get(child) ?? this.live.get(child);
    const node = record ?? this.settled.get(child);
    if (node === undefined) return undefined;
    const live = record !== undefined && record.state.status !== "terminal" ? record : undefined;
    return { id: child, live, node };
  }

  links(
    overlay: schedulerTypesModule.Overlay,
  ): ReadonlyMap<schedulerTypesModule.Node, ReadonlySet<schedulerTypesModule.Node>> {
    if (overlay.links !== undefined) return overlay.links;
    const links = new SetMap<schedulerTypesModule.Node, schedulerTypesModule.Node>();
    for (const record of overlay.tasks.values()) {
      if (this.live.has(record.id) || this.settled.has(record.id)) continue;
      this.#linkUp(links, record, overlay);
    }
    overlay.links = links;
    return links;
  }

  #linkUp(
    links: schedulerSetmapTypes.SetMap<schedulerTypesModule.Node, schedulerTypesModule.Node>,
    record: schedulerTypesModule.AnyTaskRecord,
    overlay: schedulerTypesModule.Overlay,
  ): void {
    let child: schedulerTypesModule.Node = record.id;
    let parent: schedulerTypesModule.Node | null | undefined = parentNode(record);
    while (parent !== undefined && parent !== null && links.get(parent)?.has(child) !== true) {
      links.addTo(parent, child);
      if (typeof parent !== "string" && (this.live.has(parent) || overlay.tasks.has(parent)))
        return;
      const above = this.#linkParent(parent, overlay);
      if (above !== undefined && above !== null && this.below.get(above)?.has(parent) === true)
        return;
      child = parent;
      parent = above;
    }
  }

  #linkParent(
    parent: schedulerTypesModule.Node,
    overlay: schedulerTypesModule.Overlay,
  ): schedulerTypesModule.Node | null | undefined {
    if (typeof parent === "string") return this.edge(conversationOf(parent), overlay);
    const fields = this.settled.get(parent);
    return fields === undefined ? undefined : parentNode(fields);
  }

  ownedLive(
    owner: schedulerTypesModule.TaskId,
    options: OwnedOptions = {},
  ): schedulerTypesModule.TaskId[] {
    const { overlay, first = false, done } = options;
    const found: schedulerTypesModule.TaskId[] = [];
    const walk = this.walkDown(owner, {
      ...(overlay === undefined ? {} : { overlay }),
      ...(done === undefined ? {} : { enter: (id: schedulerTypesModule.TaskId) => !done.has(id) }),
    });
    for (const { id, node, live } of walk) {
      if (live === undefined || node.background) continue;
      found.push(id);
      if (first) break;
    }
    return found;
  }

  hasOwnedLive(
    owner: schedulerTypesModule.TaskId,
    overlay?: schedulerTypesModule.Overlay,
    done?: ReadonlySet<schedulerTypesModule.TaskId>,
  ): boolean {
    const options = {
      first: true,
      ...(overlay === undefined ? {} : { overlay }),
      ...(done === undefined ? {} : { done }),
    };
    return this.ownedLive(owner, options).length > 0;
  }

  inScope(
    start: schedulerTypesModule.Up,
    scope: schedulerTypesModule.Scope,
    crossBackground = false,
  ): boolean | undefined {
    for (const step of this.above(start)) {
      if ("unknown" in step) return undefined;
      if ("conversation" in step) {
        if ("conversation" in scope && step.conversation === scope.conversation) return true;
      } else if (step.node.background && !crossBackground) {
        return false;
      }
    }
    return "roots" in scope;
  }

  belowCancelled(start: schedulerTypesModule.Up): boolean {
    return this.cancellingOwner(start) !== undefined;
  }

  cancellingOwner(start: schedulerTypesModule.Up): schedulerTypesModule.AnyTaskRecord | undefined {
    if (this.intent.size === 0) return undefined;
    for (const step of this.above(start)) {
      if ("unknown" in step) return undefined;
      if (!("task" in step)) continue;
      const live = this.live.get(step.task);
      if (live !== undefined && cancellationIntent(live)) return live;
      if (step.node.background) return undefined;
    }
    return undefined;
  }

  idle(conversationId: schedulerTypesModule.ConversationId | undefined): boolean {
    const scope: schedulerTypesModule.Scope =
      conversationId === undefined ? { roots: true } : { conversation: conversationId };
    for (const id of this.unloaded) {
      const record = this.live.get(id);
      if (
        record !== undefined &&
        !record.background &&
        this.inScope(parentOf(record), scope) !== false
      )
        return false;
    }
    const starts = conversationId === undefined ? this.roots : [conversationId];
    for (const start of starts) {
      for (const { node, live } of this.walkDown(conversationNode(start))) {
        if (live !== undefined && !node.background) return false;
      }
    }
    return true;
  }

  waitingOn(
    record: schedulerTypesModule.AnyTaskRecord,
    first = false,
  ): readonly schedulerTypesModule.TaskId[] {
    if (record.abortRequested) return this.ownedLive(record.id, { first });
    if (record.state.status !== "waiting") return [];
    if (!first) return record.state.on.filter((id) => this.live.has(id));
    const live = record.state.on.find((id) => this.live.has(id));
    return live === undefined ? [] : [live];
  }
}
