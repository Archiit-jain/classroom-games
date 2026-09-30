export interface PingSample {
  sentAt: number;
  receivedAt: number;
  serverNow: number;
}

/**
 * Estimates (server clock − local clock) from ping samples: each sample
 * assumes the server read its clock half-way through the round trip. The
 * median is robust against a few slow round trips.
 */
export function estimateOffset(samples: readonly PingSample[]): number {
  if (samples.length === 0) return 0;
  const offsets = samples
    .map((s) => s.serverNow - (s.sentAt + (s.receivedAt - s.sentAt) / 2))
    .sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  return offsets.length % 2 === 1
    ? (offsets[mid] as number)
    : ((offsets[mid - 1] as number) + (offsets[mid] as number)) / 2;
}
