import { performance } from "node:perf_hooks";

import { type CancelDelay, runAfter } from "./delay.ts";

const MIN_RENDER_INTERVAL_MS = 16;

export class RenderScheduler {
  private renderRequested = false;
  private immediateRenderScheduled = false;
  private cancelPendingRender: CancelDelay | undefined;
  private lastRenderAt = 0;
  private readonly render: () => void;
  private readonly isStopped: () => boolean;

  constructor(render: () => void, isStopped: () => boolean) {
    this.render = render;
    this.isStopped = isStopped;
  }

  renderNow(): void {
    this.renderRequested = false;
    this.cancel();
    this.renderFrame();
  }

  request(): void {
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => this.schedule());
  }

  requestImmediate(): void {
    this.cancel();
    this.renderRequested = true;
    if (this.immediateRenderScheduled) return;
    this.immediateRenderScheduled = true;
    process.nextTick(() => {
      this.immediateRenderScheduled = false;
      if (this.isStopped() || !this.renderRequested) return;
      this.cancel();
      this.renderRequested = false;
      this.renderFrame();
    });
  }

  cancel(): void {
    if (this.cancelPendingRender === undefined) return;
    this.cancelPendingRender();
    this.cancelPendingRender = undefined;
  }

  private renderFrame(): void {
    this.lastRenderAt = performance.now();
    this.render();
  }

  private schedule(): void {
    if (this.isStopped() || this.cancelPendingRender !== undefined || !this.renderRequested) {
      return;
    }
    const elapsed = performance.now() - this.lastRenderAt;
    const delay = Math.max(0, MIN_RENDER_INTERVAL_MS - elapsed);
    this.cancelPendingRender = runAfter(delay, () => {
      this.cancelPendingRender = undefined;
      if (this.isStopped() || !this.renderRequested) {
        return;
      }
      this.renderRequested = false;
      this.renderFrame();
      if (this.renderRequested) {
        this.schedule();
      }
    });
  }
}
