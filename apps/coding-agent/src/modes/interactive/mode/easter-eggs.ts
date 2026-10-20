import tuiModule from "@msa/tui";

import ArminComponent from "../components/armin.ts";
import EarendilAnnouncementComponent from "../components/earendil-announcement.ts";
import easterEgg3dLazy from "../components/easter-egg-3d.lazy.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { Spacer } = tuiModule;
const { playArmin3d } = easterEgg3dLazy;

export default class EasterEggCommands {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  handleDementedDelves(): void {
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(new EarendilAnnouncementComponent());
    this.mode.ui.requestRender();
  }

  handleArminSaysHi(): void {
    if (playArmin3d(this.mode.lifecycle.screen.renderer)) return;
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(new ArminComponent(this.mode.ui));
    this.mode.ui.requestRender();
  }
}
