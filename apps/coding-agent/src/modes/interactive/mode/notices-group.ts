import type InteractiveMode from "../interactive-mode.ts";
import CacheNotices from "./cache-notices.ts";
import ChatNotices from "./notices.ts";
import StartupNotices from "./startup-notices.ts";
import UsageNotices from "./usage-notices.ts";

export default class ModeNotices {
  readonly warnings: ChatNotices;
  readonly startup: StartupNotices;
  readonly cache: CacheNotices;
  readonly usage: UsageNotices;

  constructor(mode: InteractiveMode) {
    this.warnings = new ChatNotices(mode);
    this.startup = new StartupNotices(mode);
    this.cache = new CacheNotices(mode);
    this.usage = new UsageNotices(mode);
  }
}
