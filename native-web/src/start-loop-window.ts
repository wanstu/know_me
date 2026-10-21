export type StartLoopSlot = {
  virtual: number;
  index: number;
};

export function wrapLoopIndex(value: number, length: number) {
  if (!Number.isInteger(length) || length <= 0) throw new Error("invalid_loop_length");
  return ((value % length) + length) % length;
}

/**
 * Keep a bounded virtual window around the current group.
 * Three groups on each side give the browser enough real scroll range while
 * still keeping the DOM strictly bounded.
 */
export function startLoopSlots(center: number, groupCount: number): StartLoopSlot[] {
  if (groupCount < 2) return [];
  return [center - 3, center - 2, center - 1, center, center + 1, center + 2, center + 3].map((virtual) => ({
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
