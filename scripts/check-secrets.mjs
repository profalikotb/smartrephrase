#!/usr/bin/env node
/**
 * Verifies that no secret can reach the browser or source control.
 * 1. Rebuild-free scan of everything served to browsers (.next/static + prerendered HTML) for:
 *    - the literal value of GEMINI_API_KEY / ACCESS_PASSWORD / SESSION_SECRET / Redis token (if set at build time)
 *    - Google API key shapes (AIza…), and server-only env names.
 * 2. Scan of git-tracked (or, outside git, all project) files for key shapes and committed .env files.
 * Exit code 1 on any finding.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const findings = [];
const KEY_SHAPE = /AIza[0-9A-Za-z_\-]{35}/g;
const SERVER_ONLY_NAMES = ["GEMINI_API_KEY", "ACCESS_PASSWORD", "SESSION_SECRET", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"];
const secretValues = SERVER_ONLY_NAMES.map((n) => process.env[n]).filter((v) => v && v.length >= 8);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.size < 20 * 1024 * 1024) out.push(p);
  }
  return out;
}

// ---- 1. Browser-delivered build output ----
const clientDirs = [join(root, ".next/static"), join(root, ".next/server/app")];
const clientFiles = clientDirs.flatMap((d) => walk(d)).filter((f) => f.includes(".next/static") || /\.(html|rsc|body|txt)$/.test(f));
if (!clientFiles.length) {
  console.error("No build output found — run `npm run build` first.");
  process.exit(1);
}
for (const f of clientFiles) {
  const s = readFileSync(f, "utf8");
  for (const v of secretValues) if (s.includes(v)) findings.push(`secret VALUE present in client asset ${relative(root, f)}`);
  for (const n of SERVER_ONLY_NAMES) if (s.includes(n)) findings.push(`server-only env name "${n}" referenced in client asset ${relative(root, f)}`);
  if (KEY_SHAPE.test(s)) findings.push(`Google API key pattern in client asset ${relative(root, f)}`);
  KEY_SHAPE.lastIndex = 0;
}

// ---- 2. Source control ----
let tracked;
try {
  tracked = execSync("git ls-files -co --exclude-standard", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .split("\n")
    .filter(Boolean);
} catch {
  tracked = walk(root)
    .map((f) => relative(root, f))
    .filter((f) => !f.startsWith("node_modules") && !f.startsWith(".next") && !f.startsWith(".git/"));
}
for (const f of tracked) {
  if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example")) findings.push(`environment file would be committed: ${f}`);
  const p = join(root, f);
  if (!existsSync(p) || statSync(p).size > 2 * 1024 * 1024) continue;
  const s = readFileSync(p, "utf8");
  if (KEY_SHAPE.test(s)) findings.push(`Google API key pattern in tracked file ${f}`);
  KEY_SHAPE.lastIndex = 0;
  for (const v of secretValues) if (s.includes(v)) findings.push(`secret VALUE in tracked file ${f}`);
}
const ex = existsSync(join(root, ".env.example")) ? readFileSync(join(root, ".env.example"), "utf8") : "";
for (const line of ex.split("\n")) {
  const m = /^(GEMINI_API_KEY|ACCESS_PASSWORD|SESSION_SECRET|UPSTASH_REDIS_REST_TOKEN)=(.+)$/.exec(line.trim());
  if (m) findings.push(`.env.example contains a value for ${m[1]}`);
}
const gi = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "";
if (!/^\.env$/m.test(gi) || !/^\.env\.\*$/m.test(gi)) findings.push(".gitignore does not exclude .env / .env.*");

if (findings.length) {
  console.error("✖ Secret check failed:\n  - " + [...new Set(findings)].join("\n  - "));
  process.exit(1);
}
console.log(`✔ Secret check passed (${clientFiles.length} client assets, ${tracked.length} source files scanned; ${secretValues.length} build-time secret value(s) checked).`);
