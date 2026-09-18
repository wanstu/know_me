export function safeNextPath(value: string | null | undefined, fallback = "/admin") {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const originUrl = new URL(origin);
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ? `${forwardedProto}:` : requestUrl.protocol;

  return originUrl.host === host && originUrl.protocol === protocol;
}
