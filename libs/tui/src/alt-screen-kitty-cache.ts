import { deleteKittyImage, getKittyImagePlacement } from "./terminal-image-kitty.ts";

const MAX_CACHED_OFFSCREEN_KITTY_IMAGES = 16;
const MAX_CACHED_OFFSCREEN_KITTY_TRANSMISSION_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_OFFSCREEN_KITTY_DECODED_BYTES = 64 * 1024 * 1024;

interface CachedKittyImage {
  transmissionGeneration: number;
  transmissionBytes: number;
  estimatedDecodedBytes: number;
}

interface OffscreenUsage {
  count: number;
  transmissionBytes: number;
  decodedBytes: number;
}

export interface PreparedKittyScreen {
  lines: string[];
  evictedImageDeletion: string;
}

function withinBudget(usage: OffscreenUsage): boolean {
  return (
    usage.count <= MAX_CACHED_OFFSCREEN_KITTY_IMAGES &&
    usage.transmissionBytes <= MAX_CACHED_OFFSCREEN_KITTY_TRANSMISSION_BYTES &&
    usage.decodedBytes <= MAX_CACHED_OFFSCREEN_KITTY_DECODED_BYTES
  );
}

export class KittyImageCache {
  private readonly uploaded = new Map<number, CachedKittyImage>();

  get size(): number {
    return this.uploaded.size;
  }

  clear(): void {
    this.uploaded.clear();
  }

  prepare(screen: string[]): PreparedKittyScreen {
    const visibleImageIds = new Set<number>();
    const lines = screen.map((line) => this.reuseUploadedImage(line, visibleImageIds));
    return { lines, evictedImageDeletion: this.evictOffscreen(visibleImageIds) };
  }

  private reuseUploadedImage(line: string, visibleImageIds: Set<number>): string {
    const placement = getKittyImagePlacement(line);
    if (placement === undefined) return line;
    visibleImageIds.add(placement.imageId);
    const cachedImage = this.uploaded.get(placement.imageId);
    if (cachedImage !== undefined) this.uploaded.delete(placement.imageId);
    this.uploaded.set(placement.imageId, {
      transmissionGeneration: placement.transmissionGeneration,
      transmissionBytes: placement.transmissionBytes,
      estimatedDecodedBytes: placement.estimatedDecodedBytes,
    });
    return cachedImage?.transmissionGeneration === placement.transmissionGeneration
      ? placement.replacementLine
      : line;
  }

  private evictOffscreen(visibleImageIds: ReadonlySet<number>): string {
    const usage: OffscreenUsage = { count: 0, transmissionBytes: 0, decodedBytes: 0 };
    for (const [imageId, cachedImage] of this.uploaded) {
      if (visibleImageIds.has(imageId)) continue;
      usage.count += 1;
      usage.transmissionBytes += cachedImage.transmissionBytes;
      usage.decodedBytes += cachedImage.estimatedDecodedBytes;
    }
    let evictedImageDeletion = "";
    for (const [imageId, cachedImage] of this.uploaded) {
      if (withinBudget(usage)) break;
      if (visibleImageIds.has(imageId)) continue;
      evictedImageDeletion += deleteKittyImage(imageId);
      this.uploaded.delete(imageId);
      usage.count -= 1;
      usage.transmissionBytes -= cachedImage.transmissionBytes;
      usage.decodedBytes -= cachedImage.estimatedDecodedBytes;
    }
    return evictedImageDeletion;
  }
}
