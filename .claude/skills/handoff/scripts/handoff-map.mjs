#!/usr/bin/env node
// Reads and writes handoff_map.json in the Proton Drive Handoffs folder, so the handoff and
// lets-go skills resolve the folder, the map key, and the file format identically on every machine.
//
//   node handoff-map.mjs resolve            -> {"dir","repo","key","active","docExists"}
//   node handoff-map.mjs set <file.md|null> -> {"dir","key","previous","active"}
//
// HANDOFFS_DIR overrides the folder; the default is the same under the home directory on
// Windows and Fedora.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const MAP = 'handoff_map.json';

function fail(message) {
  console.error(`handoff-map: ${message}`);
  process.exit(1);
}

function handoffsDir() {
  const dir =
    process.env.HANDOFFS_DIR ||
    join(homedir(), 'Proton Drive', 'jwh3times', 'My Files', 'Documents', 'Handoffs');
  if (!existsSync(join(dir, MAP))) {
    fail(`no ${MAP} in ${dir}. Is Proton Drive synced on this machine? Set HANDOFFS_DIR to override.`);
  }
  // Proton Drive keeps both sides of a sync conflict as separate files; picking one silently
  // would drop the other machine's update.
  const conflicts = readdirSync(dir).filter((n) => /^handoff_map.*\.json$/i.test(n) && n !== MAP);
  if (conflicts.length) fail(`sync conflict copies need reconciling first: ${conflicts.join(', ')}`);
  return dir;
}

function repoName() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  return basename(url).replace(/\.git$/, '');
}

// Map keys predate this script and do not always match the repo name exactly
// ("LeaseBook", "GuardianTracker"), so compare case- and punctuation-insensitively.
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function resolveKey(map, repo) {
  const matches = Object.keys(map.Active_Handoffs).filter((k) => normalize(k) === normalize(repo));
  if (matches.length > 1) fail(`repo "${repo}" matches several keys: ${matches.join(', ')}`);
  return matches[0] ?? repo;
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function readMap(dir) {
  const map = JSON.parse(readFileSync(join(dir, MAP), 'utf8').replace(/^﻿/, ''));
  if (!map.Active_Handoffs || typeof map.Active_Handoffs !== 'object') {
    fail(`${MAP} has no Active_Handoffs object`);
  }
  return map;
}

const [command, value] = process.argv.slice(2);
const dir = handoffsDir();
const map = readMap(dir);
const repo = repoName();
const key = resolveKey(map, repo);
const current = map.Active_Handoffs[key] ?? null;

if (command === 'resolve') {
  const docExists = current !== null && existsSync(join(dir, current));
  console.log(JSON.stringify({ dir, repo, key, active: current, docExists }, null, 2));
} else if (command === 'set' && value) {
  const next = value === 'null' ? null : value;
  if (next !== null && !existsSync(join(dir, next))) fail(`${next} is not in ${dir}; write it first`);
  map.Last_Updated = timestamp();
  map.Active_Handoffs[key] = next;
  writeFileSync(join(dir, MAP), `${JSON.stringify(map, null, 2)}\n`);
  const written = readMap(dir).Active_Handoffs[key] ?? null;
  if (written !== next) fail(`re-read shows ${key} = ${written}, expected ${next}`);
  console.log(JSON.stringify({ dir, key, previous: current, active: written }, null, 2));
} else {
  fail('usage: handoff-map.mjs resolve | set <file.md|null>');
}
