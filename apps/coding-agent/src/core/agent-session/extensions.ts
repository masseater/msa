import type AgentSession from "../agent-session.ts";
import SessionExtensionActions from "./extension-actions.ts";
import SessionExtensionBinding from "./extension-binding.ts";
import SessionExtensionEvents from "./extension-events.ts";
import SessionExtensionResources from "./extension-resources.ts";
import SessionExtensionRuntime from "./extension-runtime.ts";

export default class SessionExtensions {
  readonly resources: SessionExtensionResources;
  readonly binding: SessionExtensionBinding;
  readonly events: SessionExtensionEvents;
  readonly actions: SessionExtensionActions;
  readonly runtime: SessionExtensionRuntime;

  constructor(session: AgentSession) {
    this.resources = new SessionExtensionResources(session);
    this.binding = new SessionExtensionBinding(session);
    this.events = new SessionExtensionEvents(session);
    this.actions = new SessionExtensionActions(session);
    this.runtime = new SessionExtensionRuntime(session);
  }
}
