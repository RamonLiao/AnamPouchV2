/**
 * Run after `sui client publish --gas-budget 100000000 --json > deploy.json`.
 * Extracts the published package ID and writes/updates frontend/.env.local.
 *
 *   pnpm tsx scripts/extract-package-id.ts ../deploy.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const inputPath = resolve(process.cwd(), process.argv[2] ?? '../deploy.json');
const envPath = resolve(process.cwd(), '.env.local');

const raw = JSON.parse(readFileSync(inputPath, 'utf8')) as {
  objectChanges?: Array<{ type: string; packageId?: string }>;
};

const published = raw.objectChanges?.find((c) => c.type === 'published');
if (!published?.packageId) {
  console.error('No "published" object change found in', inputPath);
  process.exit(1);
}

const KEY = 'VITE_PORTABLE_HEALTH_PACKAGE_ID';
const line = `${KEY}=${published.packageId}`;

let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
if (env.includes(`${KEY}=`)) {
  env = env.replace(new RegExp(`${KEY}=.*`), line);
} else {
  env += (env && !env.endsWith('\n') ? '\n' : '') + line + '\n';
}
writeFileSync(envPath, env);
console.log(`Wrote ${KEY}=${published.packageId} to ${envPath}`);
