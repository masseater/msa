import type EarendilAnnouncementComponentClass from "./earendil-announcement.ts";

declare namespace earendilAnnouncementTypes {
  type EarendilAnnouncementComponent = (typeof EarendilAnnouncementComponentClass)["prototype"];
}

export type { earendilAnnouncementTypes as default };
