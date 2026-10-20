type RequestBodyCompressor = (bodyJson: string) => Uint8Array<ArrayBuffer> | null;

let compressor: RequestBodyCompressor | undefined;

function setRequestBodyCompressor(next: RequestBodyCompressor | undefined): void {
  compressor = next;
}

function compressRequestBodyZstd(bodyJson: string): Uint8Array<ArrayBuffer> | null {
  if (compressor === undefined) return null;
  try {
    return compressor(bodyJson);
  } catch {
    return null;
  }
}

const openaiCodexCompress = {
  compressRequestBodyZstd,
  setRequestBodyCompressor,
};

export default openaiCodexCompress;
