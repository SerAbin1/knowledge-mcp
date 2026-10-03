export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Stable document id derived from the URL, so re-ingesting the same post or
// article updates it in place instead of duplicating it.
export async function documentId(url: string): Promise<string> {
  return (await sha256Hex(url)).slice(0, 32);
}
