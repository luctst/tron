/** Smallest change to `offset` that keeps `cursor` within `visible` lines. */
export function scrollTo(cursor: number, offset: number, visible: number): number {
  if (cursor < offset) return cursor
  if (cursor >= offset + visible) return cursor - visible + 1
  return offset
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
