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
