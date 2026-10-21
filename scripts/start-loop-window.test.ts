import assert from "node:assert/strict";
import { loopEdgeVirtual, nearestLoopVirtual, startLoopSlots, wrapLoopIndex } from "../native-web/src/start-loop-window";

assert.equal(wrapLoopIndex(-1, 7), 6);
assert.equal(wrapLoopIndex(7, 7), 0);
assert.equal(wrapLoopIndex(15, 7), 1);

for (const center of [-100_000, -8, -1, 0, 1, 8, 100_000]) {
  const slots = startLoopSlots(center, 7);
  assert.equal(slots.length, 3, "loop DOM window must stay bounded to three group instances");
  assert.deepEqual(slots.map((slot) => slot.virtual), [center - 1, center, center + 1]);
  assert.ok(slots.every((slot) => slot.index >= 0 && slot.index < 7));
}

const before = startLoopSlots(12, 7);
const after = startLoopSlots(13, 7);
const beforeKeys = new Set(before.map((slot) => slot.virtual));
const afterKeys = new Set(after.map((slot) => slot.virtual));
assert.equal([...beforeKeys].filter((key) => afterKeys.has(key)).length, 2, "one step must reuse two virtual nodes");
assert.equal([...beforeKeys].filter((key) => !afterKeys.has(key)).length, 1, "one step must destroy exactly one old virtual node");
assert.equal([...afterKeys].filter((key) => !beforeKeys.has(key)).length, 1, "one step must create exactly one new virtual node");

assert.equal(nearestLoopVirtual(0, 6, 7), -1, "last group should be one upward step from first");
assert.equal(nearestLoopVirtual(6, 0, 7), 7, "first group should be one downward step from last");
assert.equal(nearestLoopVirtual(100_000, wrapLoopIndex(100_000 + 1, 7), 7), 100_001);

assert.deepEqual(startLoopSlots(0, 1), [], "single group does not need looping");

assert.equal(loopEdgeVirtual(10, 0, 900, 2400), 9, "top edge should recycle the previous virtual page");
assert.equal(loopEdgeVirtual(10, 1500, 900, 2400), 11, "bottom edge should recycle the next virtual page");
assert.equal(loopEdgeVirtual(10, 700, 900, 2400), null, "middle scroll range should not force recycling");
assert.equal(loopEdgeVirtual(10, 0, 900, 900), null, "a non-scrollable document must not keep recycling");

console.log("Start loop window tests passed");
