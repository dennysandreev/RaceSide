import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maxFileBytes = 100 * 1024 * 1024;
const secretPatterns = [
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/,
  /\b(?:sk-or-v1-[a-f0-9]{40,}|sbp_[a-f0-9]{30,}|sb_secret_[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /(?:postgres(?:ql)?|https?):\/\/[^\s/:]+:[^\s/@]{5,}@/,
];

export function auditRepositoryFile(path, bytes) {
  const errors = [];
  const parts = path.split("/");
  if (parts.some(part => part.startsWith(".env") && part !== ".env.example") ||
      parts.some(part => ["node_modules", ".next", ".playwright-cli", ".playwright-mcp", ".claude", ".codex-tmp", ".track-model-build", "test-results", "playwright-report", "blob-report"].includes(part)) ||
      /^(?:output|tmp|backups|releases|Avatars f1|docs\/codemap)\//.test(path) ||
      /\.(?:log|pem|key|tsbuildinfo)$/.test(path)) errors.push("local or private artifact");
  if (bytes.length >= maxFileBytes) errors.push("file exceeds GitHub's 100 MiB limit");
  if (bytes.includes(0)) return errors;
  const text = bytes.toString("utf8");
  if (secretPatterns.some(pattern => pattern.test(text))) errors.push("possible credential; value withheld");
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      if (JSON.parse(Buffer.from(match[0].split(".")[1], "base64url")).role === "service_role") {
        errors.push("service-role JWT; value withheld");
        break;
      }
    } catch { /* Not every JWT-like example is a valid payload. */ }
  }
  return errors;
}

export function missingDocumentLinks(path, text, trackedFiles) {
  return [...text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)].map(match => match[1])
    .filter(target => !/^(?:[a-z]+:|#|\/)/i.test(target))
    .filter(target => {
      const name = resolve("/", dirname(path), decodeURIComponent(target.split("#")[0])).slice(1);
      return !trackedFiles.some(file => file === name || file.startsWith(name.replace(/\/$/, "") + "/"));
    });
}

function main() {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const gitFiles = args => execFileSync("git", ["ls-files", ...args, "-z"], { cwd, maxBuffer: 20_000_000 }).toString().split("\0").filter(Boolean);
  const files = gitFiles(["--cached"]);
  const failures = gitFiles(["--cached", "--ignored", "--exclude-standard"]).map(path => `${path}: tracked despite ignore rules`);
  for (const path of files) {
    const bytes = readFileSync(resolve(cwd, path));
    for (const error of auditRepositoryFile(path, bytes)) failures.push(`${path}: ${error}`);
    if (["README.md", "docs/README.md"].includes(path)) {
      for (const target of missingDocumentLinks(path, bytes.toString("utf8"), files)) failures.push(`${path}: untracked or missing link ${target}`);
    }
  }
  for (const path of ["README.md", "docs/README.md", ".env.example", "pnpm-lock.yaml", "PRODUCT.md", "DESIGN.md", "AGENTS.md", "SKILLS.md"]) {
    if (!files.includes(path)) failures.push(`${path}: required project file missing`);
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log(`Repository hygiene passed: ${files.length} files; no blocked artifacts or known credential patterns. This is not a full secret-history audit.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
