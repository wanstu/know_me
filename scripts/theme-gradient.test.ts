import assert from "node:assert/strict";
import { validGradientPacks } from "../native-web/src/kit";

assert.equal(validGradientPacks(["aurora", "ocean"]), true);
assert.equal(validGradientPacks(["aurora", "sakura", "ocean", "forest"]), true);
assert.equal(validGradientPacks([]), false);
assert.equal(validGradientPacks(["ocean"]), false);
assert.equal(validGradientPacks(["aurora", "aurora"]), false);
assert.equal(validGradientPacks(["aurora", "ocean", "forest", "sunset", "sakura"]), false);
assert.equal(validGradientPacks(["bad pack", "ocean"]), false);
assert.equal(validGradientPacks(["aurora", "../danger"]), false);
console.log("Know Me gradient preference validation passed");
