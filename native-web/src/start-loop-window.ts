export type StartLoopSlot = {
  virtual: number;
  index: number;
};

export function wrapLoopIndex(value: number, length: number) {
  if (!Number.isInteger(length) || length <= 0) throw new Error("invalid_loop_length");
  return ((value % length) + length) % length;
}

/**
 * Keep a fixed three-page virtual window: previous, current and next.
 * Moving one page keeps two existing virtual nodes and replaces only one.
 */
export function startLoopSlots(center: number, groupCount: number): StartLoopSlot[] {
  if (groupCount < 2) return [];
  return [center - 1, center, center + 1].map((virtual) => ({
    virtual,
    index: wrapLoopIndex(virtual, groupCount)
  }));
}

export function nearestLoopVirtual(center: number, targetIndex: number, groupCount: number) {
  if (groupCount < 2) return targetIndex;
  const currentIndex = wrapLoopIndex(center, groupCount);
  let delta = targetIndex - currentIndex;
  if (delta > groupCount / 2) delta -= groupCount;
  if (delta < -groupCount / 2) delta += groupCount;
  return center + delta;
}

/**
 * When a three-page loop reaches a physical document edge, advance the
 * virtual window before the browser runs out of scroll range. This matters
 * for short groups: the next page may never reach the normal viewport anchor
 * before the document bottom is hit.
 */
export function loopEdgeVirtual(
  center: number,
  scrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
  epsilon = 2
) {
  if (![center, scrollTop, viewportHeight, scrollHeight, epsilon].every(Number.isFinite)) return null;
  if (viewportHeight <= 0 || scrollHeight <= viewportHeight + epsilon) return null;
  if (scrollTop <= epsilon) return center - 1;
  if (scrollTop + viewportHeight >= scrollHeight - epsilon) return center + 1;
  return null;
}
