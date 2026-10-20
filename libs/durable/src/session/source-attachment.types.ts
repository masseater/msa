import type SessionSourceAttachmentClass from "./source-attachment.ts";

declare namespace sourceAttachmentTypes {
  type SessionSourceAttachment<T> = SessionSourceAttachmentClass<T>;
}

export type { sourceAttachmentTypes as default };
