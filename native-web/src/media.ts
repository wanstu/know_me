export const MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const mediaTypes = new Set<string>(MEDIA_MIME_TYPES);

export function validateMediaFile(file: File): "unsupported_media_type" | "media_size_invalid" | null {
  if (!mediaTypes.has(file.type)) return "unsupported_media_type";
  if (file.size <= 0 || file.size > MAX_MEDIA_BYTES) return "media_size_invalid";
  return null;
}
