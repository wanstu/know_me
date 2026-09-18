const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

type Check = {
  path: string;
  expect: number;
  contains?: string;
  contentType?: string;
};

const checks: Check[] = [
  { path: "/", expect: 200, contains: "know_me" },
  { path: "/blog", expect: 200, contains: "know_me / blog" },
  { path: "/feed.xml", expect: 200, contentType: "application/rss+xml" },
  { path: "/sitemap.xml", expect: 200, contentType: "application/xml" },
  { path: "/robots.txt", expect: 200, contentType: "text/plain" },
  { path: "/api/health", expect: 200, contains: "\"status\":\"ok\"" }
];

async function main() {
  for (const check of checks) {
    const response = await fetch(base + check.path, { redirect: "manual" });
    if (response.status !== check.expect) {
      throw new Error(check.path + " expected " + check.expect + ", got " + response.status);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (check.contentType && !contentType.includes(check.contentType)) {
      throw new Error(check.path + " content-type mismatch: " + contentType);
    }
    if (check.contains) {
      const body = await response.text();
      if (!body.includes(check.contains)) {
        throw new Error(check.path + " did not contain expected marker");
      }
    }
    console.log("PASS " + check.path + " " + response.status);
  }

  const protectedResponse = await fetch(base + "/start", { redirect: "manual" });
  if (![302, 303, 307, 308].includes(protectedResponse.status)) {
    throw new Error("/start expected auth redirect, got " + protectedResponse.status);
  }
  const location = protectedResponse.headers.get("location") ?? "";
  if (!location.includes("/login") || !location.includes("next=%2Fstart")) {
    throw new Error("/start redirect target invalid: " + location);
  }
  console.log("PASS /start protected " + protectedResponse.status);

  console.log("site smoke: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
