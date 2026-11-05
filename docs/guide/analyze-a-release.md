# Analyze a release

The release-impact analyst compares a prod ref with a candidate ref and selects the regression tests that should run. The analysis is deterministic; the agent adds judgment on top of the engine output.

## Before you start

Use a workspace folder that contains:

```text
team-workspace/
  repos/
    service/
    automation/
  .release-impact/
    config.json
  artifacts/
```

The config lists each repo path, its refs, and the automation repo's `framework`, `testGlobs`, and optional `caseIdPattern`. Keep `outputs.report` and `outputs.selection` under `artifacts/` so the app's analyst agent is allowed to write them.

Start from a template. Run the CLI from the team workspace, not from the Fid Coder app folder:

```powershell
cd D:\fid-coder-desktop-app
npm run build:node

cd C:\work\release-workspace
node D:\fid-coder-desktop-app\dist\cli\release-impact.js init --template playwright
```

Edit `.release-impact/config.json`. At minimum, set the repo paths, `prod`, and `candidate` refs.

## Add your repos and versions

Each repo is a normal clone inside the workspace. The engine runs git commands in those folders; it does not need the candidate branch checked out.

```text
team-workspace/
  repos/
    service-a/
    service-b/
    automation/
```

Fetch the refs first so `doctor` can resolve them:

```powershell
git -C repos\service-a fetch --tags --prune origin
git -C repos\service-b fetch --tags --prune origin
git -C repos\automation fetch --tags --prune origin
```

Then list each repo in `repos`. `role` is `source` for a product repo, `automation` for the test repo, and `contract` for a shared contract repo.

```json
{
  "schemaVersion": 1,
  "repos": [
    {
      "id": "service-a",
      "path": "repos/service-a",
      "role": "source",
      "prod": "refs/tags/prod-2026.09.1",
      "candidate": "refs/tags/release-2026.10.0"
    },
    {
      "id": "service-b",
      "path": "repos/service-b",
      "role": "source",
      "prod": "a1b2c3d",
      "candidate": "q3r4s5t"
    },
    {
      "id": "automation",
      "path": "repos/automation",
      "role": "automation",
      "framework": "playwright",
      "testGlobs": ["tests/**/*.spec.ts"],
      "caseIdPattern": "TC-\\d+",
      "prod": "m0n1o2p",
      "candidate": "c2d3e4f"
    }
  ],
  "mapping": {
    "explicit": [
      { "match": "service-a/src/**", "tests": ["automation/tests/**"] }
    ]
  },
  "outputs": {
    "report": "artifacts/impact-report.md",
    "selection": "artifacts/selected-tests.json",
    "selectionFormat": "playwright-grep"
  }
}
```

`prod` is the version currently deployed. `candidate` is the version you are about to release. Both accept a tag, branch, `origin/branch`, short SHA, full SHA, `HEAD`, `HEAD~1`, or `HEAD^`. The test inventory is read from the automation repo's `candidate` ref.

For a release manifest, put the pinned SHAs in a separate file and point `releaseManifest` at it. The manifest wins over per-repo refs.

```json
{
  "releaseManifest": "releases/2026.10.json"
}
```

```json
{
  "prod": {
    "service-a": "a1b2c3d",
    "service-b": "e4f5g6h",
    "automation": "m0n1o2p"
  },
  "candidate": {
    "service-a": "q3r4s5t",
    "service-b": "u6v7w8x",
    "automation": "c2d3e4f"
  }
}
```

When a manifest is set, `--prod` and `--candidate` are ignored with a warning. Use the manifest for a real release; it cannot accidentally compare moving branches.

## Check the config first

```powershell
node D:\fid-coder-desktop-app\dist\cli\release-impact.js doctor
node D:\fid-coder-desktop-app\dist\cli\release-impact.js analyze --dry-run
```

`doctor` validates the config, refs, test discovery, and adapter. Fix every error before continuing. `--dry-run` runs the deterministic pipeline without writing files.

The automation adapter always skips any folder named `Deprecated` (case-insensitive). Add other exclusions to `ignore`; that list now applies to automation test discovery as well as the source diff.

## Run the analysis

```powershell
node D:\fid-coder-desktop-app\dist\cli\release-impact.js analyze
```

The engine writes:

- `artifacts/impact-report.md` — the full-regression recommendation, selected tests, new scenarios, risks, and unknowns.
- `artifacts/selected-tests.json` — the structured selection and the CI text (`selectionText`).

Use `explain <test-id>` to see why one test was selected:

```powershell
node D:\fid-coder-desktop-app\dist\cli\release-impact.js explain TC-1042
```

## Use the agent

Open Fid Coder and select the **Release Impact Analyst** agent. Set its workspace to the folder that contains `.release-impact/config.json`. Send a prompt such as:

```text
Analyze the current release and prepare the impact report.
```

The agent calls `impact_analyze`, reads the files named in the result, and writes the final report under `artifacts/`. It cannot run shell commands, use the browser, or edit source and automation repos.

## Full regression

Full regression is extra. The must-run and should-run lists are still the selection. The engine recommends the full suite only for a path in `policy.fullRegression`, a changed contract file, an adapter that found no tests, or a repo that could not be diffed. A large diff, a large suite, and low mapping coverage stay in the notes.

## Large releases

For a release with 100+ source files or 300+ automation tests, the report names the matched tests by folder and lists source folders that no must-run test covers.

1. Map a source folder to the tests for that folder, for example `service/src/**/orders/**` to `automation/tests/orders/**`. A map that matches most of the suite does not mark every test must-run. Tests in that map are selected when an endpoint, selector, symbol, or module name also matches.
2. Put only safety paths in `policy.fullRegression`, such as `**/auth/**` and `**/migrations/**`. Leave out `**/package.json`, `**/pom.xml`, and `**/*.proto` unless a change there should run the whole suite.
3. If the report says it analyzed or indexed only a prefix, raise `policy.maxDetailFiles` or `policy.maxTestFiles`.
4. `policy.maxChangedFiles` and `policy.minMappingCoverage` add a note. They do not replace the selected tests.

```json
"mapping": {
  "explicit": [
    { "match": "service/src/**/orders/**", "tests": ["automation/tests/orders/**"] },
    { "match": "service/src/**/billing/**", "tests": ["automation/tests/billing/**"] }
  ]
},
"policy": {
  "fullRegression": ["**/auth/**", "**/migrations/**"],
  "maxDetailFiles": 800,
  "maxTestFiles": 1000
}
```

## Selection formats

`outputs.selectionFormat` controls `selectionText`:

- `file-list` — one test file per line.
- `playwright-grep` — a `--grep` pattern.
- `testng-xml` — a generated suite file.
- `cucumber-tags` — a tag expression.
- `junit` — a class/method list.
- `json` — the structured list.

The JSON file always contains the full selection. Use `selectionText` for the CI command.
