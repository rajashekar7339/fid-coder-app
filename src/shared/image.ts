const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

export function imageMimeForPath(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension ? IMAGE_MIME[extension] ?? null : null;
}
