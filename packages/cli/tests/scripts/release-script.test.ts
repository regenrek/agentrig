import { describe, expect, it } from "vite-plus/test";

import {
  allowNonMainOverride,
  bumpSemver,
  extractChangelogSection,
  formatGhReleaseCreateCommand,
  parseVersionBumpArg,
} from "../../../../scripts/release";

describe("scripts/release", () => {
  it("parses bump args", () => {
    expect(parseVersionBumpArg("patch")).toEqual({ kind: "bump", value: "patch" });
    expect(parseVersionBumpArg("Minor")).toEqual({ kind: "bump", value: "minor" });
  });

  it("parses explicit semver args", () => {
    expect(parseVersionBumpArg("0.2.3")).toEqual({ kind: "explicit", value: "0.2.3" });
    expect(parseVersionBumpArg("v1.0.0")).toEqual({ kind: "explicit", value: "1.0.0" });
  });

  it("rejects invalid version args", () => {
    expect(() => parseVersionBumpArg("lol")).toThrow(/Invalid version argument/);
    expect(() => parseVersionBumpArg('0.2.3" && rm -rf /')).toThrow(/Invalid version argument/);
  });

  it("bumps semver", () => {
    expect(bumpSemver("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpSemver("0.1.9", "patch")).toBe("0.1.10");
    expect(bumpSemver("0.1.0", "minor")).toBe("0.2.0");
    expect(bumpSemver("0.1.0", "major")).toBe("1.0.0");
  });

  it("accepts only ALLOW_NON_MAIN=1", () => {
    expect(allowNonMainOverride("1")).toBe(true);
    expect(allowNonMainOverride(undefined)).toBe(false);
    expect(allowNonMainOverride("0")).toBe(false);
    expect(() => allowNonMainOverride("true")).toThrow(/ALLOW_NON_MAIN=true is not supported/);
  });

  it("extracts a changelog section", () => {
    const text = [
      "# Changelog",
      "",
      "## [0.2.0] - 2026-01-24",
      "### Added",
      "- Feature X",
      "",
      "## [0.1.9] - 2026-01-10",
      "- Older",
      "",
    ].join("\n");

    const section = extractChangelogSection(text, "0.2.0");
    expect(section).toContain("## [0.2.0]");
    expect(section).toContain("Feature X");
    expect(section).not.toContain("## [0.1.9]");
  });

  it("rejects malformed changelog headers for the requested version", () => {
    const text = [
      "# Changelog",
      "",
      "## [0.2.0]",
      "- Missing date",
      "",
    ].join("\n");

    expect(() => extractChangelogSection(text, "0.2.0")).toThrow(/Expected header: ## \[0\.2\.0\] - YYYY-MM-DD/);
  });

  it("formats a recoverable GitHub Release create command", () => {
    expect(formatGhReleaseCreateCommand("0.7.2", "/tmp/release-notes-0.7.2.md")).toBe(
      "gh release create v0.7.2 --notes-file /tmp/release-notes-0.7.2.md",
    );
    expect(formatGhReleaseCreateCommand("v0.7.2", "/tmp/release notes.md")).toBe(
      "gh release create v0.7.2 --notes-file '/tmp/release notes.md'",
    );
  });
});
