/**
 * The model returns the rewrite first; optional sections follow fixed marker lines.
 * Markers are ASCII so they survive any script and are trivial to detect mid-stream.
 */
export const MARKERS = {
  flags: "@@FLAGS@@",
  notes: "@@NOTES@@",
  alt: "@@ALT@@",
} as const;

export interface ParsedOutput {
  /** Primary rewrite (or first alternative). */
  main: string;
  /** Additional versions (alternatives variant only). */
  alternatives: string[];
  flags: string[];
  notes: string[];
}

const MARKER_RE = /^[ \t]*@@(FLAGS|NOTES|ALT)@@[ \t]*$/gm;

/** Safe to call on partial streams: a half-received marker is hidden rather than shown as text. */
export function parseOutput(raw: string): ParsedOutput {
  let text = raw.replace(/\r\n?/g, "\n");
  // Hide a marker that is still arriving at the very end of the stream.
  text = text.replace(/\n?[ \t]*@{1,2}(?:F(?:L(?:A(?:G(?:S(?:@@?)?)?)?)?)?|N(?:O(?:T(?:E(?:S(?:@@?)?)?)?)?)?|A(?:L(?:T(?:@@?)?)?)?)?$/u, "");

  const segments: { kind: "main" | "FLAGS" | "NOTES" | "ALT"; body: string }[] = [];
  let last = 0;
  let kind: "main" | "FLAGS" | "NOTES" | "ALT" = "main";
  for (const m of text.matchAll(MARKER_RE)) {
    segments.push({ kind, body: text.slice(last, m.index) });
    kind = m[1] as "FLAGS" | "NOTES" | "ALT";
    last = (m.index ?? 0) + m[0].length;
  }
  segments.push({ kind, body: text.slice(last) });

  const versions: string[] = [];
  const flags: string[] = [];
  const notes: string[] = [];
  for (const s of segments) {
    const body = s.body.replace(/^\n+|\s+$/g, "");
    if (s.kind === "main" || s.kind === "ALT") {
      if (body || s.kind === "main") versions.push(body);
    } else {
      const items = toItems(body);
      if (s.kind === "FLAGS") flags.push(...items);
      else notes.push(...items);
    }
  }
  const [main = "", ...alternatives] = versions;
  return { main, alternatives: alternatives.filter(Boolean), flags, notes };
}

function toItems(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter((l) => l && !/^(none|no flags|لا يوجد|لا توجد)\.?$/iu.test(l));
}
