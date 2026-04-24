// ASCII spider banner — shown on `weave up` and `weave init`. Inspired by
// Weaver from DOTA 2 (long-legged broodling) and the way Claude Code /
// OpenCode use their letterforms in the start-of-session header.
//
// Kept short on purpose — user said: "I'm more worried about ease of
// functionality than UI."

const SPIDER_FRAMES = [
  // frame 0 — legs splayed
  String.raw`
       . - - .
     ╱  o o  ╲
    │   ◡    │
   ╱│         │╲
  ╱ │  W E A  │ ╲
 '  │  V E R  │  '
    │         │
   ╲│         │╱
    ╲╱       ╲╱`,
  // frame 1 — legs flexed
  String.raw`
       . - - .
     ╱  o o  ╲
    │   ◡    │
    │         │
   ╳ │ W E A │ ╳
   ╳ │ V E R │ ╳
    │         │
    │         │
    ╳         ╳`,
  // frame 2 — back to splayed (mirror of 0)
  String.raw`
       . - - .
     ╱  o o  ╲
    │   ◡    │
   ╱│         │╲
  ╱ │  W E A  │ ╲
 '  │  V E R  │  '
    │         │
   ╲│         │╱
    ╲╱       ╲╱`,
];

// ANSI codes — orange foreground, dim, bold, reset.
const ORANGE = "\x1b[38;5;208m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function bannerStatic(tagline?: string): string {
  const art = SPIDER_FRAMES[0]!;
  const tag = tagline ? `\n${DIM}  ${tagline}${RESET}\n` : "\n";
  return `${ORANGE}${art}${RESET}${tag}`;
}

// Tiny ~600ms animation. Skipped if stdout isn't a TTY (CI, pipes) so we
// don't spam control codes into logs. Best-effort — failures are silent.
export async function playBanner(tagline?: string): Promise<void> {
  if (!process.stdout.isTTY) {
    process.stdout.write(bannerStatic(tagline));
    return;
  }

  const lines = SPIDER_FRAMES[0]!.split("\n").length;

  for (let i = 0; i < SPIDER_FRAMES.length; i++) {
    if (i > 0) {
      // Move cursor up `lines` and clear them.
      process.stdout.write(`\x1b[${lines}A\x1b[0J`);
    }
    process.stdout.write(`${ORANGE}${SPIDER_FRAMES[i]}${RESET}`);
    if (i < SPIDER_FRAMES.length - 1) await sleep(180);
  }
  if (tagline) process.stdout.write(`\n${DIM}  ${tagline}${RESET}\n`);
  else process.stdout.write("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
