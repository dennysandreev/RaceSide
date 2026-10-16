import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const file of [".env.local", ".env"]) {
  const path = resolve(root, file);
  if (existsSync(path)) process.loadEnvFile(path);
}

const directory = resolve(root, "supabase/templates/auth");
const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
const patch = {};
const allowedVariables = new Set(["ConfirmationURL", "Token", "Email", "NewEmail", "OldEmail"]);
for (const email of manifest) {
  const html = await readFile(resolve(directory, email.file), "utf8");
  if (Buffer.byteLength(html) > 100_000 || /<script|<iframe|data:image|localhost|preview-only|```/i.test(html)) {
    throw new Error(`Invalid production template: ${email.id}`);
  }
  for (const [, variable] of html.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)) {
    if (!allowedVariables.has(variable)) throw new Error(`Unknown template variable: ${variable}`);
  }
  if (email.id === "reauthentication" && !html.includes("{{ .Token }}")) throw new Error("Missing OTP");
  if (["confirmation", "recovery", "magic_link", "invite", "email_change"].includes(email.id)
      && !html.includes('href="{{ .ConfirmationURL }}"')) throw new Error(`Missing auth link: ${email.id}`);
  patch[`mailer_subjects_${email.id}`] = email.subject;
  patch[`mailer_templates_${email.id}_content`] = html;
}

if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ validated: true, templates: manifest.map(({ id, subject }) => ({ id, subject })), fields: Object.keys(patch) }, null, 2));
  process.exit(0);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF
  ?? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!token || !/^[a-z]{20}$/.test(projectRef)) throw new Error("SUPABASE_ACCESS_TOKEN and valid project ref are required");
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
async function request(method, body) {
  const response = await fetch(endpoint, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Supabase auth config ${method} failed (${response.status})`);
  return response.json();
}

const before = await request("GET");
const backup = Object.fromEntries(Object.keys(patch).map(key => [key, before[key] ?? ""]));
const backupDir = resolve(root, "output/auth-emails/backups");
await mkdir(backupDir, { recursive: true });
await writeFile(resolve(backupDir, `${projectRef}-${Date.now()}.json`), `${JSON.stringify(backup, null, 2)}\n`, { mode: 0o600 });
await request("PATCH", patch);
const after = await request("GET");
const mismatches = Object.keys(patch).filter(key => after[key] !== patch[key]);
if (mismatches.length) throw new Error(`Email template verification failed: ${mismatches.join(", ")}`);
console.log(JSON.stringify({ ok: true, projectRef, templates: manifest.length, verified: true }));
