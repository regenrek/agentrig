// @ts-nocheck
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURE: Update these for your project
// ─────────────────────────────────────────────────────────────────────────────
const CLI_DIR = "cli"; // relative path to CLI package
const CLI_NAME = "your-cli"; // package name (used in GH release title)

interface PackageTarget {
  name: string;
  dir: string;
  bump?: boolean;
}

const packageTargets: PackageTarget[] = [
  { name: CLI_NAME, dir: CLI_DIR, bump: true },
];

function run(command: string, cwd: string) {
  console.log(`Executing: ${command} in ${cwd}`);
  execSync(command, { stdio: "inherit", cwd });
}

function ensureCleanWorkingTree() {
  const status = execSync("git status --porcelain", { cwd: "." })
    .toString()
    .trim();
  if (status.length > 0) {
    throw new Error(
      "Working tree has uncommitted changes. Please commit or stash them before running the release script.",
    );
  }
}

function bumpVersion(
  pkgPath: string,
  type: "major" | "minor" | "patch" | string,
): string {
  const pkgJsonPath = path.join(pkgPath, "package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const currentVersion = pkgJson.version;
  let newVersion: string;

  if (type === "major" || type === "minor" || type === "patch") {
    const [major, minor, patch] = currentVersion.split(".").map(Number);
    if (type === "major") {
      newVersion = `${major + 1}.0.0`;
    } else if (type === "minor") {
      newVersion = `${major}.${minor + 1}.0`;
    } else {
      newVersion = `${major}.${minor}.${patch + 1}`;
    }
  } else {
    newVersion = type;
  }

  pkgJson.version = newVersion;
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
  console.log(`Bumped version from ${currentVersion} to ${newVersion} in ${pkgJsonPath}`);
  return newVersion;
}

function bumpAllVersions(
  versionBump: "major" | "minor" | "patch" | string = "patch",
): string {
  const target = packageTargets[0];
  const pkgPath = path.resolve(target.dir);
  return bumpVersion(pkgPath, versionBump);
}

function createGitCommitAndTag(version: string) {
  console.log("Creating git commit and tag...");
  try {
    run("git add .", ".");
    run(`git commit -m "chore: release v${version}"`, ".");
    run(`git tag -a v${version} -m "Release v${version}"`, ".");
    console.log("Pushing commit and tag to remote...");
    run("git push", ".");
    run("git push --tags", ".");
    console.log(`Successfully created and pushed git tag v${version}`);
  } catch (error) {
    console.error("Failed to create git commit and tag:", error);
    throw error;
  }
}

async function releasePackages(
  versionBump: "major" | "minor" | "patch" | string = "patch",
) {
  ensureCleanWorkingTree();
  const newVersion = bumpAllVersions(versionBump);
  run(`pnpm -C ${CLI_DIR} build`, ".");
  console.log("Release tag created; npm publish will run via GitHub Actions (Trusted Publishing).");
  createGitCommitAndTag(newVersion);

  try {
    createGithubRelease(newVersion);
  } catch (e) {
    console.warn("Skipping GitHub Release creation:", e);
  }
}

const args = process.argv.slice(2);
const versionBumpArg = args[0] || "patch";

releasePackages(versionBumpArg).catch(console.error);

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Release helpers
// ─────────────────────────────────────────────────────────────────────────────

function hasGhCLI(): boolean {
  try {
    execSync("gh --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function changelogSection(versionLike: string): string | null {
  const file = path.resolve("CHANGELOG.md");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
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

function ghReleaseExists(tag: string): boolean {
  try {
    execSync(`gh release view ${tag}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function createGithubRelease(version: string) {
  if (!hasGhCLI()) return;
  const tag = `v${version}`;
  const title = `${CLI_NAME} ${tag}`;
  let notes = changelogSection(version);

  if (!notes) {
    const alt = process.env.GH_NOTES_REF || "0.1";
    notes = changelogSection(alt) || undefined;
  }

  const tmp = path.join(os.tmpdir(), `release-notes-${version}.md`);
  if (notes) fs.writeFileSync(tmp, notes);

  const exists = ghReleaseExists(tag);
  const cmd = exists
    ? `gh release edit ${tag} --title "${title}" ${notes ? `--notes-file ${tmp}` : "--generate-notes"}`
    : `gh release create ${tag} --title "${title}" ${notes ? `--notes-file ${tmp}` : "--generate-notes"}`;

  console.log(`${exists ? "Updating" : "Creating"} GitHub Release ${tag}...`);
  execSync(cmd, { stdio: "inherit" });
}
