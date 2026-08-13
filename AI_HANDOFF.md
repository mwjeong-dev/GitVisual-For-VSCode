# GitVisual AI Handoff

This document is the working context for future AI-assisted development. Read it before changing GitVisual.

## Product

- Name: GitVisual
- VS Code extension ID: `mwjeong-dev.gitvisual-vscode`
- Publisher: `mwjeong-dev`
- Current package version: `0.1.5`
- License: MIT
- Marketplace icon: `media/marketplace-icon.png`
- Activity Bar icon: `media/commit.svg`
- Internal IDs remain `gitTools.*` for compatibility. Do not rename them casually.

## Product Decisions

- GitVisual is a visual Git client, not a replacement for the built-in Git extension. It depends on `vscode.git`.
- The commit panel uses GitVisual-local checkbox state. Checking a file must not run `git add` or move it between VS Code SCM groups.
- `Default` selects only tracked files owned by the Default changelist.
- `Unversioned Files` is a separate status-derived group. Untracked files must never be moved into Default merely by selection.
- Opening the Activity Bar view must not automatically select all files. Newly discovered files are not auto-selected.
- The Activity Bar badge shows the total changed-file count. Commit buttons show the selected-file count.
- Selective commits use a scratch `GIT_INDEX_FILE`; preserve unrelated working-tree and externally staged changes.
- Block selective commits during merge, rebase, or cherry-pick operations.

## Push Workflow

- `Commit and Push…`, the branch context-menu `Push…`, and command `GitVisual: Push…` open the same Push Preview webview.
- Push Preview shows the local branch, remote target, commits to push, and the selected commit's file tree.
- Clicking a file opens a VS Code commit diff.
- Push Preview supports normal Push and true Force Push (`git push --force`). Force Push requires a modal warning.
- Do not add a separate Force Push button back to the commit panel unless product direction changes.
- When a non-checked-out local branch is pushed, use an explicit `localBranch:remoteBranch` refspec.
- If the branch has no upstream, Push Preview targets `origin` (or the first configured remote) and sets upstream.

## Branch Explorer

- Sections: Local, Remote, Tags.
- Local branches with upstream display divergence:
  - blue `↙ n` = commits to pull (behind)
  - green `↗ n` = commits to push (ahead)
- Compute divergence with `git rev-list --left-right --count local...remote`; do not rely solely on optional VS Code Git API `ahead`/`behind` fields.
- `Update selected branch` uses a download-style icon, not a compare icon.
- Local branches and tags can be deleted after confirmation.
- Remote deletion is available only from a remote branch's context menu, not the left-side trash button. It parses `remote/branch`, runs `git push <remote> --delete <branch>`, then fetches with prune. It requires a strong confirmation because it mutates the remote repository.
- The Branch Explorer no longer exposes `Create patch from selection`. Commit-level patch export remains available from the commit graph.

## Resizable UI

- The graph details split is draggable and persisted in `localStorage`.
- The commit area is vertically resizable from its top edge and persisted under `gitvisual.commitPanel.commitBoxHeight`.
- Keep a minimum commit-area height that leaves options, a short message field, and buttons usable.

## Localization

- Supported package/UI languages: English, Korean, Japanese, Simplified Chinese, Traditional Chinese, Spanish, German, French, and Brazilian Portuguese.
- Webviews use `src/shared/localization.ts` and English keys with optional Korean fallbacks.
- New user-visible strings should be localized when practical; Git/system errors may remain in their original language.

## Key Files

- `src/extension.ts`: activation and provider wiring
- `src/commitPanel/commitPanelViewProvider.ts`: selective commit orchestration
- `web/commitPanel/main.ts`: commit/changelist UI and checkbox state
- `src/scm/commitService.ts`: scratch-index selective commits
- `src/scm/changelistStore.ts`: changelist ownership and reconciliation
- `src/branches/branchesViewProvider.ts`: branch operations and divergence calculation
- `web/branches/main.ts`: branch tree UI and context menus
- `src/pushPreview/pushPreviewPanel.ts`: Push Preview data and Git push execution
- `web/pushPreview/main.ts`: Push Preview UI
- `src/graph/graphViewProvider.ts`, `web/graph/main.ts`: commit graph

## Packaging and Release

- Validate with:
  - `npm run typecheck`
  - `npm run test:unit`
  - `npm run build`
- Package with `npx @vscode/vsce package --out gitvisual-vscode-<version>.vsix`.
- Inspect the VSIX file list. `.idea/**`, `.vscode/**`, source, tests, and existing VSIX files must be excluded by `.vscodeignore`.
- Marketplace rejects re-uploading an already-published version. Bump the patch version if that version is already live.
- Preserve user changes in the dirty worktree. Do not reset or discard unrelated files.

## Known Limitations

- Most views currently target the first detected repository.
- Merge conflict editing is delegated to the VS Code Merge Editor.
- Branch remote names are represented as `remote/branch`; remote deletion assumes the first slash separates them.
- Force Push is intentionally destructive and has no lease protection by current product decision.
