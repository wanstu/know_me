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
 * Wheel fallback for the physical document edges. It only advances when the
 * user is still scrolling outward, so layout compensation cannot recursively
 * trigger another recycle and cause flicker.
 */
export function loopWheelEdgeVirtual(
  center: number,
  deltaY: number,
  scrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
  epsilon = 2
) {
  if (![center, deltaY, scrollTop, viewportHeight, scrollHeight, epsilon].every(Number.isFinite)) return null;
  if (viewportHeight <= 0 || scrollHeight <= viewportHeight + epsilon || deltaY === 0) return null;
  if (deltaY < 0 && scrollTop <= epsilon) return center - 1;
  if (deltaY > 0 && scrollTop + viewportHeight >= scrollHeight - epsilon) return center + 1;
  return null;
}
