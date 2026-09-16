# lolskills-scan

Check a skill before installing it. For Claude Code and Codex, by [MagicSword](https://www.magicsword.io).

`lolskills-scan` sends a public GitHub skill to [LOLSkills](https://lolskills.io), checks the result, and tells your agent whether to continue or pause. It checks the exact commit you plan to install.

Requires **Node.js 22+**. No API key, npm install, or local scanner needed.

## Installation

Read [SKILL.md](SKILL.md) and [the helper](scripts/check-skill.mjs), then choose your agent.
These commands work on macOS, Linux, and WSL.

**Claude Code**

```sh
mkdir -p ~/.claude/skills
git clone https://github.com/magicsword-io/lolskills-scan.git ~/.claude/skills/lolskills-scan
```

**Codex**

```sh
mkdir -p ~/.agents/skills
git clone https://github.com/magicsword-io/lolskills-scan.git ~/.agents/skills/lolskills-scan
```

Restart your agent to load the skill. Cloning does not run anything. If the folder already exists, review your local changes and upstream changes before updating. You can check out a release tag to use a specific version.

**Prefer a ZIP?** Download **[lolskills-scan.zip](https://github.com/magicsword-io/lolskills-scan/releases/latest/download/lolskills-scan.zip)** from [GitHub Releases](https://github.com/magicsword-io/lolskills-scan/releases). Extract the `lolskills-scan` folder into your agent's skills directory above. The final path should end in `lolskills-scan/SKILL.md`. On native Windows, use the same folders under your user profile.

Each release includes `SHA256SUMS`. To verify the download, run `shasum -a 256 -c SHA256SUMS` in the directory containing both files.

## Use it

Ask your agent:

```text
Use lolskills-scan to check this GitHub skill before installing it: <skill URL>
```

You can also invoke `/lolskills-scan` in Claude Code or `$lolskills-scan` in Codex.

The agent finds the commit and SKILL.md path, submits the check, and waits for the result:

| Result | What happens |
| --- | --- |
| No findings (exit 0) | Continue the installation you authorized at the checked version. |
| Findings or concerns (exit 2) | Pause and review the results. |
| Incomplete (exit 3) | Keep installation paused. Missing checks never count as a pass. |

A scan can take several minutes. The helper waits up to 25 minutes and does not automatically resubmit failed requests.

To verify installation without starting a scan, run this from the skill folder:

```sh
node scripts/check-skill.mjs --help
```

## What to know

- The helper sends the public repository, commit, and skill path to LOLSkills. It does not upload local files, install the target, or print private report links.
- Public scans share the service's [usage limits](https://lolskills.io/docs/api). Private repositories and locally modified files are outside this workflow.
- Optional AI assessment is off by default. Request it explicitly if wanted; it shares scanned context with the configured provider and cannot override findings or missing checks.
- This guides your agent when it uses the skill. It does not block every installer. A completed scan is not a safety guarantee; changed files need another check.

[How scanning works](https://lolskills.io/methodology) · [Privacy](https://lolskills.io/privacy) · [Setup page](https://lolskills.io/docs/install-protection)

## Development

```sh
node --test tests/check-skill.test.mjs
python3 scripts/package-release.py
```

Tests use synthetic responses and make no live scan requests. The packaging script creates `dist/lolskills-scan.zip` and `dist/SHA256SUMS` from an explicit file list. Check both assets and test the extracted helper before attaching them to a release at the reviewed commit. Keep existing release assets unchanged.

## License

[Apache-2.0](LICENSE). Retain [NOTICE](NOTICE). MagicSword trademarks and the separate private scanner are not included in the license grant.

Thanks to [NOVA Framework](https://github.com/Nova-Hunting/nova-framework) and [YARA Forge](https://github.com/YARAHQ/yara-forge), used by the hosted scanner.
