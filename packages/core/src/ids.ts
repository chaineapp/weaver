// Short, time-ordered project ids. Not a strict ULID — a simpler variant that's
// enough for single-user ordering and human-readability.

const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

export function newProjectId(): string {
  const ms = Date.now();
  const ts = encodeBase32(ms, 10);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => ALPHA[b % ALPHA.length])
    .join("");
  return `${ts}-${rand}`;
}

function encodeBase32(n: number, len: number): string {
  let s = "";
  let v = n;
  for (let i = 0; i < len; i++) {
    s = ALPHA[v % 32] + s;
    v = Math.floor(v / 32);
  }
  return s;
}

export function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen);
}

export function worktreeName(repo: string, branch: string, linear?: string | null): string {
  const branchSlug = slugify(branch);
  const parts = [repo, branchSlug];
  if (linear) parts.push(linear);
  return parts.filter(Boolean).join("-");
}
