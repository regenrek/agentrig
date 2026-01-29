#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const patternsFileName = ".forbidden-paths.regex";

const repoRoot = findRepoRoot(process.cwd());
const patternsPath = path.join(repoRoot, patternsFileName);

if (!fs.existsSync(patternsPath)) {
  process.exit(0);
}

const patterns = loadPatterns(patternsPath);
if (patterns.length === 0) {
  process.exit(0);
}

const stagedFiles = listStagedFiles(repoRoot);
if (stagedFiles.length === 0) {
  process.exit(0);
}

const violations = [];
for (const filePath of stagedFiles) {
  for (const { raw, re } of patterns) {
    if (re.test(filePath)) {
      violations.push({ filePath, pattern: raw });
    }
  }
}

if (violations.length > 0) {
  console.error("Blocked commit: forbidden file(s) staged:");
  for (const v of violations) {
    console.error(`- ${v.filePath} (matched: ${v.pattern})`);
  }
  console.error(`Update ${patternsFileName} or unstage the files and retry.`);
  process.exit(1);
}

function listStagedFiles(cwd) {
  const out = execFileSync("git", ["diff", "--cached", "--name-only", "-z"], {
    cwd,
    encoding: "utf8",
  });
  return out.split("\0").filter(Boolean);
}

function loadPatterns(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    try {
      out.push({ raw: trimmed, re: new RegExp(trimmed) });
    } catch (e) {
      throw new Error(`Invalid regex in ${patternsFileName}: "${trimmed}" (${e})`);
    }
  }
  return out;
}

function findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}
