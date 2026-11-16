/** 32-bit FNV-1a as 8 hex characters: short, stable, no crypto dependency. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The id a final answer cites for code that isn't a stored chunk: lines read
 * with read_file (`r-…`) or an endpoint declaration (`e-…`). Search hits are
 * cited by their chunk id. Ids are deterministic, so the same read in one
 * turn yields the same id, and opaque, so the model copies rather than builds them.
 */
export const sourceIdFor = (kind: 'read' | 'endpoint', key: string): string =>
  `${kind === 'read' ? 'r' : 'e'}-${fnv1a(key)}`;
