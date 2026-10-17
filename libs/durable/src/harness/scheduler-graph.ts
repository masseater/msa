import { SchedulerIndex } from "./scheduler-index.ts";
import {
  cancellationIntent,
  conversationNode,
  conversationOf,
  parentNode,
  parentOf,
} from "./scheduler-records.ts";
import { SetMap } from "./scheduler-setmap.ts";
import type {
  AnyTaskRecord,
  ConversationId,
  Node,
  Overlay,
  Scope,
  Step,
  TaskId,
  Up,
  Walked,
  WalkOptions,
} from "./scheduler-types.ts";

type OwnedOptions = {
  readonly overlay?: Overlay;
  readonly first?: boolean;
  readonly done?: ReadonlySet<TaskId>;
};

export class SchedulerGraph extends SchedulerIndex {
  *above(start: Up, overlay?: Overlay): Generator<Step> {
    let at: Up | undefined = start;
    while (at !== undefined) {
      if ("task" in at) {
        const node = this.node(at.task, overlay);
        if (node === undefined) {
          yield { unknown: true };
          return;
        }
        yield { task: at.task, node };
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

  *walkDown(start: Node, options: WalkOptions = {}): Generator<Walked> {
    const { overlay, crossBackground = false, enter } = options;
    const links = overlay === undefined ? undefined : this.links(overlay);
    const pending: Node[] = [start];
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

  #walked(child: TaskId, overlay: Overlay | undefined): Walked | undefined {
    const record = overlay?.tasks.get(child) ?? this.live.get(child);
    const node = record ?? this.settled.get(child);
    if (node === undefined) return undefined;
    const live = record !== undefined && record.state.status !== "terminal" ? record : undefined;
    return { id: child, node, live };
  }

  links(overlay: Overlay): ReadonlyMap<Node, ReadonlySet<Node>> {
    if (overlay.links !== undefined) return overlay.links;
    const links = new SetMap<Node, Node>();
    for (const record of overlay.tasks.values()) {
      if (this.live.has(record.id) || this.settled.has(record.id)) continue;
      this.#linkUp(links, record, overlay);
    }
    overlay.links = links;
    return links;
  }

  #linkUp(links: SetMap<Node, Node>, record: AnyTaskRecord, overlay: Overlay): void {
    let child: Node = record.id;
    let parent: Node | null | undefined = parentNode(record);
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

  #linkParent(parent: Node, overlay: Overlay): Node | null | undefined {
    if (typeof parent === "string") return this.edge(conversationOf(parent), overlay);
    const fields = this.settled.get(parent);
    return fields === undefined ? undefined : parentNode(fields);
  }

  ownedLive(owner: TaskId, options: OwnedOptions = {}): TaskId[] {
    const { overlay, first = false, done } = options;
    const found: TaskId[] = [];
    const walk = this.walkDown(owner, {
      ...(overlay === undefined ? {} : { overlay }),
      ...(done === undefined ? {} : { enter: (id: TaskId) => !done.has(id) }),
    });
    for (const { id, node, live } of walk) {
      if (live === undefined || node.background) continue;
      found.push(id);
      if (first) break;
    }
    return found;
  }

  hasOwnedLive(owner: TaskId, overlay?: Overlay, done?: ReadonlySet<TaskId>): boolean {
    const options = {
      first: true,
      ...(overlay === undefined ? {} : { overlay }),
      ...(done === undefined ? {} : { done }),
    };
    return this.ownedLive(owner, options).length > 0;
  }

  inScope(start: Up, scope: Scope, crossBackground = false): boolean | undefined {
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

  belowCancelled(start: Up): boolean {
    return this.cancellingOwner(start) !== undefined;
  }

  cancellingOwner(start: Up): AnyTaskRecord | undefined {
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

  idle(conversationId: ConversationId | undefined): boolean {
    const scope: Scope =
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

  waitingOn(record: AnyTaskRecord, first = false): readonly TaskId[] {
    if (record.abortRequested) return this.ownedLive(record.id, { first });
    if (record.state.status !== "waiting") return [];
    if (!first) return record.state.on.filter((id) => this.live.has(id));
    const live = record.state.on.find((id) => this.live.has(id));
    return live === undefined ? [] : [live];
  }
}
