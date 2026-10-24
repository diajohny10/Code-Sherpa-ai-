// Audit staged source before publishing. Never print secret values or excerpts.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const secrets = new Set();
const placeholders = new Set(['your-private-api-key', 'your-key', 'URL_ENCODED_PASSWORD', 'replace-with-a-long-random-password']);
const findings = [];
const remember = value => {
  if (typeof value === 'string' && value.length >= 8 && !placeholders.has(value)) secrets.add(value);
};
for (const name of ['.env', '.env.supabase']) {
  try {
    const parsed = parseEnv((await readFile(new URL('../' + name, import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
    for (const [key, value] of Object.entries(parsed)) {
      if (/(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD)$|DATABASE_URL$/i.test(key)) remember(value);
      if (/DATABASE_URL$/i.test(key) && value) {
        try { const url = new URL(value); remember(url.password); remember(decodeURIComponent(url.password)); } catch {}
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') findings.push({ file: name, rule: 'private-config-audit-failed' });
  }
}
for (const name of ['OPENAI_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN']) remember(process.env[name]);
const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).map(value => {
  const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(value);
  if (!match) throw new Error('Unable to inspect Git index metadata.');
  return { mode: match[1], oid: match[2], stage: match[3], name: match[4] };
});
const rules = [
  ['openai-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['aws-access-key', /\bAKIA[A-Z0-9]{16}\b/],
];
const safeName = name => {
  let safe = name;
  for (const value of secrets) safe = safe.split(value).join('[REDACTED]');
  for (const [, pattern] of rules) safe = safe.replace(pattern, '[REDACTED]');
  return safe;
};
let bytes = 0;
for (const { name, mode, oid, stage } of entries) {
  const safe = safeName(name);
  const lower = name.toLowerCase();
  const envFile = lower.split('/').at(-1).startsWith('.env');
  if ((envFile && !['.env.example', '.env.supabase.example'].includes(lower)) ||
      /^(?:node_modules|\.venv|dist|verification)\//.test(lower) ||
      (/^public\/python-runtime\//.test(lower) && lower !== 'public/python-runtime/readme.md')) {
    findings.push({ file: safe, rule: 'private-or-generated-file-staged' });
  }
  if (stage !== '0') { findings.push({ file: safe, rule: 'unmerged-index-entry' }); continue; }
  if (mode === '120000') { findings.push({ file: safe, rule: 'symlink-needs-review' }); continue; }
  const size = Number(execFileSync('git', ['cat-file', '-s', oid], { cwd: root, encoding: 'utf8' }));
  bytes += size;
  if (size > 50 * 1024 * 1024) { findings.push({ file: safe, rule: 'oversized-file' }); continue; }
  const content = execFileSync('git', ['cat-file', 'blob', oid], { cwd: root, maxBuffer: 51 * 1024 * 1024 });
  const text = content.toString('utf8');
  for (const value of secrets) {
    if (text.includes(value)) { findings.push({ file: safe, rule: 'configured-secret-in-source' }); break; }
  }
  for (const [rule, pattern] of rules) if (pattern.test(text)) findings.push({ file: safe, rule });
}
console.log(JSON.stringify({ status: findings.length ? 'blocked' : 'passed', stagedFiles: entries.length,
  stagedBytes: bytes, findings }, null, 2));
process.exitCode = findings.length || !entries.length ? 1 : 0;
