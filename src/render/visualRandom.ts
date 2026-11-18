import { Rng } from '../core/rng';

const random = new Rng(0x10d6e0);
let depth = 0;

/** Allocate visual objects without drawing UUIDs from the simulation stream.
 * The callback is strictly synchronous. Nested allocations share this stream. */
export function withVisualRandom<T>(build: () => T): T {
  if (depth) return build();
  const original = Math.random;
  depth++;
  Math.random = () => random.float();
  try {
    return build();
  } finally {
    depth--;
    Math.random = original;
  }
}
