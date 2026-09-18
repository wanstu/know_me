import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "../lib/auth/rate-limit";
import { isSameOriginRequest, safeNextPath } from "../lib/auth/request";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const request = new Request("http://127.0.0.1:3000/api/auth/login", {
  method: "POST",
  headers: {
    origin: "http://127.0.0.1:3000",
    host: "127.0.0.1:3000",
    "x-real-ip": "203.0.113.99"
  }
});

const username = "__security_smoke__";
clearLoginFailures(request, username);

assert(isSameOriginRequest(request), "same-origin request rejected");
assert(safeNextPath("/admin", "/") === "/admin", "safe internal path rejected");
assert(safeNextPath("https://evil.example/", "/admin") === "/admin", "external redirect was accepted");
assert(safeNextPath("//evil.example/", "/admin") === "/admin", "protocol-relative redirect was accepted");

for (let index = 0; index < 10; index += 1) recordLoginFailure(request, username);
const limited = checkLoginRateLimit(request, username);
assert(!limited.allowed, "login rate limit did not block after repeated failures");
assert(limited.retryAfterSeconds > 0, "rate limit retry value invalid");

clearLoginFailures(request, username);
assert(checkLoginRateLimit(request, username).allowed, "rate limit did not clear");

console.log("security smoke: PASS");
