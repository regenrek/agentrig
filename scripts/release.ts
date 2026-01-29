import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURE: Update these for your project
// ─────────────────────────────────────────────────────────────────────────────
const CLI_DIR = "packages/cli"; // relative path to CLI package
const CLI_NAME = "agentrig"; // package name (used in GH release title)
const DEFAULT_BRANCH = "main";

interface PackageTarget {
  name: string;
  dir: string;
  bump?: boolean;
}

const packageTargets: PackageTarget[] = [
  { name: CLI_NAME, dir: CLI_DIR, bump: true },
];

function run(cmd: string, args: string[], cwd: string) {
  console.log(`Executing: ${cmd} ${args.join(" ")} (cwd=${cwd})`);
  execFileSync(cmd, args, { stdio: "inherit", cwd });
}

function runCapture(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();
}

function ensureCleanWorkingTree(repoRoot: string) {
  const status = runCapture("git", ["status", "--porcelain"], repoRoot);
  if (status.length > 0) {
    throw new Error("Working tree has uncommitted changes. Commit or stash first.");
  }
}

function ensureOnBranch(repoRoot: string, branch: string) {
  const current = runCapture("git", ["branch", "--show-current"], repoRoot);
  if (current !== branch) {
    const allowed = process.env.ALLOW_NON_MAIN === "1" || process.env.ALLOW_NON_MAIN === "true";
    if (!allowed) {
      throw new Error(`Refusing to release from branch "${current}". Checkout "${branch}" or set ALLOW_NON_MAIN=1.`);
    }
  }
}

export type VersionBump =
  | { kind: "bump"; value: "major" | "minor" | "patch" }
  | { kind: "explicit"; value: string };

function isSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

export function parseVersionBumpArg(arg: string): VersionBump {
  const raw = (arg || "patch").trim();
  const lowered = raw.toLowerCase();
  if (lowered === "major" || lowered === "minor" || lowered === "patch") {
    return { kind: "bump", value: lowered };
  }
  const withoutV = lowered.startsWith("v") ? lowered.slice(1) : lowered;
  if (!isSemver(withoutV)) {
    throw new Error(`Invalid version argument "${arg}". Use major|minor|patch or X.Y.Z`);
  }
  return { kind: "explicit", value: withoutV };
}

export function bumpSemver(
  currentVersion: string,
  bump: "major" | "minor" | "patch",
): string {
  if (!isSemver(currentVersion)) {
    throw new Error(`package.json version "${currentVersion}" is not X.Y.Z`);
  }
  const [major, minor, patch] = currentVersion.split(".").map((n) => Number(n));
  if ([major, minor, patch].some((n) => Number.isNaN(n))) {
    throw new Error(`package.json version "${currentVersion}" is not numeric X.Y.Z`);
  }
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function bumpVersionInPackageJson(pkgJsonPath: string, bump: VersionBump): string {
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const currentVersion = String(pkgJson.version || "").trim();
  const nextVersion =
    bump.kind === "bump" ? bumpSemver(currentVersion, bump.value) : bump.value;

  pkgJson.version = nextVersion;
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
  console.log(`Bumped version ${currentVersion} → ${nextVersion} in ${pkgJsonPath}`);
  return nextVersion;
}

function bumpAllVersions(repoRoot: string, bump: VersionBump): string {
  const target = packageTargets.find((t) => t.bump);
  if (!target) throw new Error("No packageTargets marked for version bump");
  const pkgJsonPath = path.join(repoRoot, target.dir, "package.json");
  return bumpVersionInPackageJson(pkgJsonPath, bump);
}

function stageReleaseFiles(repoRoot: string) {
  const paths = new Set<string>();

  for (const target of packageTargets) {
    if (!target.bump) continue;
    paths.add(path.join(target.dir, "package.json"));
  }

  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  if (fs.existsSync(changelogPath)) paths.add("CHANGELOG.md");

  const lockfilePath = path.join(repoRoot, "pnpm-lock.yaml");
  if (fs.existsSync(lockfilePath)) paths.add("pnpm-lock.yaml");

  run("git", ["add", "--", ...Array.from(paths)], repoRoot);
}

function createGitCommitTagAndPush(repoRoot: string, version: string) {
  const tag = `v${version}`;
  run("git", ["commit", "-m", `chore: release ${tag}`], repoRoot);
  run("git", ["tag", "-a", tag, "-m", `Release ${tag}`], repoRoot);

  run("git", ["push", "origin", "HEAD"], repoRoot);
  run("git", ["push", "origin", tag], repoRoot);
}

async function releasePackages(bump: VersionBump) {
  const repoRoot = path.resolve(".");
  ensureCleanWorkingTree(repoRoot);
  ensureOnBranch(repoRoot, DEFAULT_BRANCH);

  const newVersion = bumpAllVersions(repoRoot, bump);
  run("pnpm", ["-C", CLI_DIR, "build"], repoRoot);

  console.log("Creating release commit + tag (publishing runs via GitHub Actions on GitHub Release)...");
  stageReleaseFiles(repoRoot);
  createGitCommitTagAndPush(repoRoot, newVersion);

  try {
    createGithubRelease(repoRoot, newVersion);
  } catch (e) {
    console.warn("Skipping GitHub Release creation:", e);
  }
}

const args = process.argv.slice(2);
const versionBumpArg = args[0] || "patch";

async function main() {
  const bump = parseVersionBumpArg(versionBumpArg);
  await releasePackages(bump);
}

function isDirectRun(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return import.meta.url === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Release helpers
// ─────────────────────────────────────────────────────────────────────────────

function hasGhCLI(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractChangelogSection(
  changelogText: string,
  versionLike: string,
): string | null {
  const text = changelogText;
  const lines = text.split(/\r?\n/);

  const headerRe = new RegExp(`^## \\[${escapeRegExp(versionLike)}\\](?:\\s|$)`);
  const nextHeaderRe = /^## \[/;

  const start = lines.findIndex((l) => headerRe.test(l));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextHeaderRe.test(lines[i])) {
      end = i;
      break;
    }
  }

  const section = lines.slice(start, end).join("\n").trimEnd() + "\n";
  const withoutHeader = section.split(/\r?\n/).slice(1).join("\n").trim();
  return withoutHeader.length > 0 ? section : null;
}

function changelogSection(repoRoot: string, versionLike: string): string | null {
  const file = path.join(repoRoot, "CHANGELOG.md");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  return extractChangelogSection(text, versionLike);
}

function ghReleaseExists(tag: string): boolean {
  try {
    execFileSync("gh", ["release", "view", tag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function createGithubRelease(repoRoot: string, version: string) {
  if (!hasGhCLI()) return;
  const tag = `v${version}`;
  const title = `${CLI_NAME} ${tag}`;
  let notes = changelogSection(repoRoot, version);

  if (!notes) {
    const alt = process.env.GH_NOTES_REF || "0.1";
    notes = changelogSection(repoRoot, alt) || undefined;
  }

  const tmp = path.join(os.tmpdir(), `release-notes-${version}.md`);
  if (notes) fs.writeFileSync(tmp, notes);

  const exists = ghReleaseExists(tag);
  console.log(`${exists ? "Updating" : "Creating"} GitHub Release ${tag}...`);
  const args = exists
    ? ["release", "edit", tag, "--title", title]
    : ["release", "create", tag, "--title", title];
  if (notes) args.push("--notes-file", tmp);
  else args.push("--generate-notes");
  execFileSync("gh", args, { stdio: "inherit", cwd: repoRoot });
}
