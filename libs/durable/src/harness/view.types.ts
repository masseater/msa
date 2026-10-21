import type sessionTypes from "../session/session.types.ts";
import type typesModule from "./types.types.ts";
import type viewMountTypes from "./view-mount.types.ts";
import type viewTypesModule from "./view-types.ts";
import type view from "./view.ts";

declare namespace viewTypes {
  type ConversationView = viewTypesModule.ConversationView;

  type ViewObserver = viewTypesModule.ViewObserver;

  type ConversationViews = (typeof view.ConversationViews)["prototype"];

  type SessionImpl = sessionTypes.SessionImpl;

  type Mount = viewMountTypes.Mount;

  type ConversationId = typesModule.ConversationId;

  type DocumentId = typesModule.DocumentId;

  type JsonObject = typesModule.JsonObject;

  type Storage = typesModule.Storage;

  type WatchHandle<T> = typesModule.WatchHandle<T>;
}

export type { viewTypes as default };
