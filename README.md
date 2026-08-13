# GitVisual

GitVisual is a visual Git workspace for Visual Studio Code. Organize local changes into changelists, select exactly what to commit, explore branches, inspect commit history, and review blame information without leaving the editor.

> [!WARNING]
> GitVisual is currently in Preview. Selective commits use an isolated scratch index. Keep important work backed up and report unexpected Git behavior through [GitHub Issues](https://github.com/mwjeong-dev/vscode_git_tools/issues).

## Highlights

- Changelist-oriented local change management
- Fast file and group selection without running `git add` on every click
- Selective commits built through an isolated scratch index
- Line-level selection for tracked files
- Separate Unversioned Files group based on the actual Git status
- Local, remote, and tag explorer with checkout and management actions
- Interactive commit graph with branch filtering and commit details
- Inline blame and selected-line history
- Commit, amend, commit-and-push, patch, branch, and tag workflows
- English, Korean, Japanese, Simplified Chinese, Traditional Chinese, Spanish, German, French, and Brazilian Portuguese UI

## Changelists and Selective Commits

File checkboxes represent inclusion in the next GitVisual commit. They are intentionally separate from the real Git staging state, so selecting many files remains immediate and unversioned files do not move between groups merely because they were selected.

When committing, GitVisual builds the selected content in a temporary `GIT_INDEX_FILE` and creates an isolated commit. Unselected working-tree changes and externally staged content are preserved.

You can:

- Select individual files or an entire changelist
- Create, rename, and delete changelists
- Move tracked files between changelists
- Select changed lines for a partial commit
- Commit all selected changes or only the selected files in one changelist
- Amend the latest commit
- Commit and push in one action

## Branch Explorer

The GitVisual Activity Bar view organizes references into Local, Remote, and Tags sections.

- Search branches and tags
- Checkout local branches, remote branches, tags, or revisions
- Create branches and tags from a selected reference
- Push and update branches
- Delete local branches and tags with confirmation
- Create patch files
- Double-click a reference to filter the commit graph

## Commit Graph

The bottom-panel GitVisual view renders a visual history from `git log --all --topo-order`.

- Colored branch and merge lanes
- Search by message, author, reference, or hash
- Filter history by branch
- View commit metadata and changed files
- Resize the changed-files and commit-details panes
- Open file diffs for a commit
- Copy hashes, create patches, cherry-pick, checkout, compare, reset, revert, fix up, rebase, and create branches or tags

## Blame and Line History

- Toggle inline blame from the editor title or Command Palette
- Inspect author, date, hash, and summary in blame hovers
- Open the related commit or previous revision
- Select lines and run `GitVisual: Show Line Range History`

## Safety

GitVisual blocks selective commits while a merge, rebase, or cherry-pick is in progress. Resolve, continue, or abort the operation with VS Code Source Control before committing through GitVisual.

Current Preview limitations:

- The commit panel currently targets the first detected repository
- Merge conflict resolution is delegated to the VS Code Merge Editor
- The commit graph loads up to `gitTools.graph.maxCommits` commits, 300 by default
- Initial amend behavior in a repository without a valid `HEAD` is not supported
- Git itself limits line-history traversal across some renames and merges

## Quick Start

1. Open a folder containing a Git repository.
2. Open **GitVisual** from the Activity Bar.
3. Select files under a changelist or **Unversioned Files**.
4. Enter a commit message.
5. Choose **All Selected Changes** or a specific changelist.
6. Select **Commit** or **Commit and Push**.

The commit graph is available from the bottom-panel **GitVisual** tab.

## Supported Languages

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Deutsch
- Français
- Português (Brasil)

Marketplace metadata, command names, views, webviews, and supported native dialogs follow the VS Code display language. Git and system error messages without a translation are shown in their original form.

## Installation

Install GitVisual from the Visual Studio Marketplace, or install a downloaded VSIX with:

```bash
code --install-extension gitvisual-vscode-0.1.2.vsix
```

You can also run **Extensions: Install from VSIX...** from the Command Palette.

## Settings

| Setting | Default | Description |
|---|---:|---|
| `gitTools.graph.maxCommits` | `300` | Maximum number of commits loaded into the graph. |

The internal `gitTools.*` setting and command identifiers are retained for compatibility.

## Feedback and Bug Reports

Please use [GitHub Issues](https://github.com/mwjeong-dev/vscode_git_tools/issues) and include:

- Operating system and VS Code version
- Git version and GitVisual version
- Exact reproduction steps
- Relevant GitVisual Output or error messages
- A sanitized sample repository when possible

Prefix possible data-loss, index-corruption, or unsafe-commit reports with `[Safety]`. GitVisual does not collect telemetry or usage analytics.

## Development

Requirements: Node.js 18+, npm, Git, and VS Code.

```bash
npm install
npm run watch
```

Press `F5` to open an Extension Development Host. Reload that window with `Ctrl+R` after source changes.

Validation and packaging commands:

```bash
npm run typecheck
npm run test:unit
npm run build
npx @vscode/vsce package
```

## License

GitVisual is released under the [MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for included third-party code and attribution.
