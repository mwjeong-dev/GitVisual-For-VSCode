import type {
	ChangedFileDto,
	ChangelistDto,
	ExtensionToWebviewMessage,
	WebviewToExtensionMessage,
} from '../../src/shared/protocol/commitPanel';
import type { DiffHunk } from '../../src/shared/protocol/diff';

const vscode = acquireVsCodeApi();

function post(message: WebviewToExtensionMessage): void {
	vscode.postMessage(message);
}

let files: ChangedFileDto[] = [];
let changelists: ChangelistDto[] = [];
let selectedFileUri: string | undefined;
let currentHunks: DiffHunk[] = [];
let selectedKeys = new Set<string>();
let lastCommitMessage = '';
let renamingChangelistId: string | undefined;
let creatingChangelist = false;

const root = document.getElementById('root')!;
root.innerHTML = `
	<div class="layout">
		<div class="file-list" id="file-list"></div>
		<div class="diff-view" id="diff-view"></div>
		<div class="commit-box">
			<select id="commit-target"></select>
			<textarea id="commit-message" placeholder="Commit message"></textarea>
			<label class="amend-row"><input type="checkbox" id="amend-checkbox"> Amend</label>
			<button id="commit-button">Commit</button>
		</div>
	</div>
`;

const style = document.createElement('style');
style.textContent = `
	html, body { height: 100%; overflow-x: hidden; }
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0; margin: 0; }
	.layout { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

	.file-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; border-bottom: 1px solid var(--vscode-panel-border); }

	.group-header { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--vscode-sideBarSectionHeader-background); cursor: pointer; }
	.group-header:hover { background: var(--vscode-list-hoverBackground); }
	.group-header .chevron { flex: 0 0 auto; width: 1em; text-align: center; opacity: 0.8; }
	.group-header input[type="checkbox"] { flex: 0 0 auto; margin: 0; }
	.group-header .group-label { font-weight: 600; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.group-header .group-label input { width: 100%; box-sizing: border-box; }
	.group-header .count { opacity: 0.65; font-size: 0.9em; flex: 0 0 auto; }
	.group-header .icon-button { flex: 0 0 auto; visibility: hidden; padding: 0 4px; line-height: 1; }
	.group-header:hover .icon-button { visibility: visible; }

	.new-changelist-row { padding: 3px 8px; opacity: 0.7; cursor: pointer; font-size: 0.9em; }
	.new-changelist-row:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
	.new-changelist-row input { width: 100%; box-sizing: border-box; }

	.file-item { display: flex; align-items: center; gap: 6px; padding: 2px 8px 2px 26px; cursor: pointer; min-width: 0; }
	.file-item:hover { background: var(--vscode-list-hoverBackground); }
	.file-item.selected { background: var(--vscode-list-activeSelectionBackground); }
	.file-item input[type="checkbox"] { flex: 0 0 auto; margin: 0; }
	.file-item .path { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.file-item .name { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
	.file-item.untracked .name { color: var(--vscode-gitDecoration-untrackedResourceForeground); }
	.file-item .dir { opacity: 0.6; margin-left: 6px; font-size: 0.9em; }
	.file-item .move-select { flex: 0 0 auto; visibility: hidden; max-width: 100px; font-size: 0.85em; }
	.file-item:hover .move-select, .file-item.selected .move-select { visibility: visible; }

	.diff-view { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
	.hunk-header { background: var(--vscode-diffEditor-unchangedRegionBackground, #3332); padding: 2px 6px; opacity: 0.8; white-space: nowrap; }
	.diff-line { display: flex; white-space: pre; padding: 0 6px; }
	.diff-line.add { background: var(--vscode-diffEditor-insertedTextBackground); }
	.diff-line.del { background: var(--vscode-diffEditor-removedTextBackground); }
	.diff-line input { margin-right: 6px; flex: 0 0 auto; }
	.diff-line .content { flex: 1 1 auto; }

	.commit-box { flex: 0 0 auto; display: flex; flex-direction: column; padding: 6px; gap: 6px; border-top: 1px solid var(--vscode-panel-border); }
	.amend-row { display: flex; align-items: center; gap: 4px; font-size: 0.9em; cursor: pointer; }
	textarea, select, input[type="text"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: inherit; }
	textarea { resize: vertical; min-height: 3em; }
	button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; cursor: pointer; }
	button:hover { background: var(--vscode-button-hoverBackground); }
	.error-banner { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); padding: 4px 8px; }
`;
document.head.appendChild(style);

const fileListEl = document.getElementById('file-list')!;
const diffViewEl = document.getElementById('diff-view')!;
const commitTargetEl = document.getElementById('commit-target') as HTMLSelectElement;
const commitMessageEl = document.getElementById('commit-message') as HTMLTextAreaElement;
const amendCheckboxEl = document.getElementById('amend-checkbox') as HTMLInputElement;
const commitButtonEl = document.getElementById('commit-button') as HTMLButtonElement;

amendCheckboxEl.addEventListener('change', () => {
	if (amendCheckboxEl.checked && commitMessageEl.value.trim().length === 0) {
		commitMessageEl.value = lastCommitMessage;
	}
});

commitButtonEl.addEventListener('click', () => {
	const message = commitMessageEl.value;
	if (message.trim().length === 0 && !amendCheckboxEl.checked) {
		return;
	}
	const amend = amendCheckboxEl.checked;
	if (commitTargetEl.value === 'index') {
		post({ type: 'commit', message, amend });
	} else {
		post({ type: 'commitChangelist', changelistId: commitTargetEl.value, message, amend });
	}
	commitMessageEl.value = '';
	amendCheckboxEl.checked = false;
});

function renderCommitTargetOptions(): void {
	const previous = commitTargetEl.value;
	commitTargetEl.innerHTML = '';

	const indexOption = document.createElement('option');
	indexOption.value = 'index';
	indexOption.textContent = 'All Staged Changes';
	commitTargetEl.appendChild(indexOption);

	for (const changelist of changelists) {
		const option = document.createElement('option');
		option.value = changelist.id;
		option.textContent = changelist.name;
		commitTargetEl.appendChild(option);
	}

	const stillValid = [...commitTargetEl.options].some((o) => o.value === previous);
	commitTargetEl.value = stillValid ? previous : 'index';
}

function lineKey(hunkIndex: number, lineIndex: number): string {
	return `${hunkIndex}:${lineIndex}`;
}

function allLineKeys(): Set<string> {
	const keys = new Set<string>();
	currentHunks.forEach((hunk, hunkIndex) =>
		hunk.lines.forEach((line, lineIndex) => {
			if (line.type !== 'context') {
				keys.add(lineKey(hunkIndex, lineIndex));
			}
		}),
	);
	return keys;
}

/**
 * Stage/unstage acts on the whole file, but if that file's diff happens to
 * be open, its line checkboxes are separate render state (`selectedKeys`)
 * that doesn't otherwise know the file's staged status just changed —
 * without this they'd stay checked after unstaging the whole file/group.
 */
function syncDiffSelectionIfOpen(uri: string, staged: boolean): void {
	if (uri !== selectedFileUri) {
		return;
	}
	selectedKeys = staged ? allLineKeys() : new Set();
	renderDiff();
}

function splitPath(relPath: string): { name: string; dir: string } {
	const idx = relPath.lastIndexOf('/');
	return idx === -1 ? { name: relPath, dir: '' } : { name: relPath.slice(idx + 1), dir: relPath.slice(0, idx) };
}

interface RenderGroup {
	readonly id: string;
	readonly label: string;
	readonly files: ChangedFileDto[];
	readonly changelistId?: string;
	readonly isDefault?: boolean;
}

function buildGroups(): RenderGroup[] {
	const groups: RenderGroup[] = changelists.map((changelist) => ({
		id: changelist.id,
		label: changelist.name,
		files: files.filter((f) => !f.isUntracked && f.changelistId === changelist.id),
		changelistId: changelist.id,
		isDefault: changelist.isDefault,
	}));
	const unversioned = files.filter((f) => f.isUntracked);
	if (unversioned.length > 0) {
		groups.push({ id: 'unversioned', label: 'Unversioned Files', files: unversioned });
	}
	return groups;
}

function renderFileItem(file: ChangedFileDto, showMoveSelect: boolean): HTMLElement {
	const { name, dir } = splitPath(file.relPath);

	const item = document.createElement('div');
	item.className = 'file-item' + (file.uri === selectedFileUri ? ' selected' : '') + (file.isUntracked ? ' untracked' : '');
	item.title = file.relPath;

	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.checked = file.isStaged;
	checkbox.addEventListener('click', (e) => e.stopPropagation());
	checkbox.addEventListener('change', () => {
		post({ type: checkbox.checked ? 'stageFile' : 'unstageFile', uri: file.uri });
		syncDiffSelectionIfOpen(file.uri, checkbox.checked);
	});
	item.appendChild(checkbox);

	const pathEl = document.createElement('span');
	pathEl.className = 'path';

	const nameEl = document.createElement('span');
	nameEl.className = 'name';
	nameEl.textContent = name;
	pathEl.appendChild(nameEl);

	if (dir) {
		const dirEl = document.createElement('span');
		dirEl.className = 'dir';
		dirEl.textContent = dir;
		pathEl.appendChild(dirEl);
	}
	item.appendChild(pathEl);

	if (showMoveSelect && changelists.length > 1) {
		const select = document.createElement('select');
		select.className = 'move-select';
		select.title = 'Move to changelist';
		select.addEventListener('click', (e) => e.stopPropagation());
		for (const changelist of changelists) {
			const option = document.createElement('option');
			option.value = changelist.id;
			option.textContent = changelist.name;
			option.selected = changelist.id === file.changelistId;
			select.appendChild(option);
		}
		select.addEventListener('change', () => {
			post({ type: 'moveToChangelist', uri: file.uri, changelistId: select.value });
		});
		item.appendChild(select);
	}

	item.addEventListener('click', () => {
		selectedFileUri = file.uri;
		renderFileList();
		post({ type: 'selectFile', uri: file.uri });
	});

	return item;
}

function commitRename(changelistId: string, name: string): void {
	renamingChangelistId = undefined;
	const trimmed = name.trim();
	if (trimmed.length > 0) {
		post({ type: 'renameChangelist', id: changelistId, name: trimmed });
	}
	renderFileList();
}

function renderGroupHeader(group: RenderGroup): HTMLElement {
	const header = document.createElement('div');
	header.className = 'group-header';

	const chevron = document.createElement('span');
	chevron.className = 'chevron';
	chevron.textContent = collapsedGroups.has(group.id) ? '▸' : '▾';
	header.appendChild(chevron);

	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.checked = group.files.length > 0 && group.files.every((f) => f.isStaged);
	checkbox.indeterminate = !checkbox.checked && group.files.some((f) => f.isStaged);
	checkbox.addEventListener('click', (e) => e.stopPropagation());
	checkbox.addEventListener('change', () => {
		for (const file of group.files) {
			if (checkbox.checked && !file.isStaged) {
				post({ type: 'stageFile', uri: file.uri });
				syncDiffSelectionIfOpen(file.uri, true);
			} else if (!checkbox.checked && file.isStaged) {
				post({ type: 'unstageFile', uri: file.uri });
				syncDiffSelectionIfOpen(file.uri, false);
			}
		}
	});
	header.appendChild(checkbox);

	const labelWrap = document.createElement('span');
	labelWrap.className = 'group-label';
	if (group.changelistId && renamingChangelistId === group.changelistId) {
		const input = document.createElement('input');
		input.type = 'text';
		input.value = group.label;
		input.addEventListener('click', (e) => e.stopPropagation());
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				commitRename(group.changelistId!, input.value);
			} else if (e.key === 'Escape') {
				renamingChangelistId = undefined;
				renderFileList();
			}
		});
		input.addEventListener('blur', () => commitRename(group.changelistId!, input.value));
		labelWrap.appendChild(input);
		setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	} else {
		labelWrap.textContent = group.label;
		if (group.changelistId) {
			labelWrap.addEventListener('dblclick', (e) => {
				e.stopPropagation();
				renamingChangelistId = group.changelistId;
				renderFileList();
			});
		}
	}
	header.appendChild(labelWrap);

	const count = document.createElement('span');
	count.className = 'count';
	count.textContent = `${group.files.length} file${group.files.length === 1 ? '' : 's'}`;
	header.appendChild(count);

	if (group.changelistId && !group.isDefault) {
		const deleteButton = document.createElement('button');
		deleteButton.className = 'icon-button';
		deleteButton.textContent = '×';
		deleteButton.title = 'Delete Changelist';
		deleteButton.addEventListener('click', (e) => {
			e.stopPropagation();
			post({ type: 'deleteChangelist', id: group.changelistId! });
		});
		header.appendChild(deleteButton);
	}

	header.addEventListener('click', () => {
		if (collapsedGroups.has(group.id)) {
			collapsedGroups.delete(group.id);
		} else {
			collapsedGroups.add(group.id);
		}
		renderFileList();
	});

	return header;
}

function submitCreateChangelist(name: string): void {
	creatingChangelist = false;
	const trimmed = name.trim();
	if (trimmed.length > 0) {
		post({ type: 'createChangelist', name: trimmed });
	}
	renderFileList();
}

function renderNewChangelistRow(): HTMLElement {
	const row = document.createElement('div');
	row.className = 'new-changelist-row';
	if (creatingChangelist) {
		const input = document.createElement('input');
		input.type = 'text';
		input.placeholder = 'Changelist name';
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				submitCreateChangelist(input.value);
			} else if (e.key === 'Escape') {
				creatingChangelist = false;
				renderFileList();
			}
		});
		input.addEventListener('blur', () => submitCreateChangelist(input.value));
		row.appendChild(input);
		setTimeout(() => input.focus(), 0);
	} else {
		row.textContent = '+ New Changelist';
		row.addEventListener('click', () => {
			creatingChangelist = true;
			renderFileList();
		});
	}
	return row;
}

const collapsedGroups = new Set<string>();

function renderFileList(): void {
	fileListEl.innerHTML = '';
	for (const group of buildGroups()) {
		fileListEl.appendChild(renderGroupHeader(group));
		if (!collapsedGroups.has(group.id)) {
			for (const file of group.files) {
				fileListEl.appendChild(renderFileItem(file, group.changelistId !== undefined));
			}
		}
	}
	fileListEl.appendChild(renderNewChangelistRow());
}

function sendSelection(): void {
	if (!selectedFileUri) {
		return;
	}
	post({ type: 'setSelection', uri: selectedFileUri, selectedKeys: [...selectedKeys] });
}

function renderDiff(): void {
	diffViewEl.innerHTML = '';
	const currentFile = files.find((f) => f.uri === selectedFileUri);
	const selectable = !currentFile?.isUntracked;

	currentHunks.forEach((hunk, hunkIndex) => {
		const header = document.createElement('div');
		header.className = 'hunk-header';
		header.textContent = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.sectionHeading}`;
		diffViewEl.appendChild(header);

		hunk.lines.forEach((line, lineIndex) => {
			const lineEl = document.createElement('div');
			lineEl.className = `diff-line ${line.type}`;

			if (selectable && line.type !== 'context') {
				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				const key = lineKey(hunkIndex, lineIndex);
				checkbox.checked = selectedKeys.has(key);
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) {
						selectedKeys.add(key);
					} else {
						selectedKeys.delete(key);
					}
					sendSelection();
				});
				lineEl.appendChild(checkbox);
			}

			const content = document.createElement('span');
			content.className = 'content';
			const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
			content.textContent = prefix + line.content;
			lineEl.appendChild(content);

			diffViewEl.appendChild(lineEl);
		});
	});
}

function showError(message: string): void {
	const banner = document.createElement('div');
	banner.className = 'error-banner';
	banner.textContent = message;
	root.prepend(banner);
	setTimeout(() => banner.remove(), 5000);
}

window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
	const message = event.data;
	switch (message.type) {
		case 'fileList':
			files = message.files;
			changelists = message.changelists;
			lastCommitMessage = message.lastCommitMessage ?? '';
			if (selectedFileUri && !files.some((f) => f.uri === selectedFileUri)) {
				selectedFileUri = undefined;
				currentHunks = [];
			}
			renderCommitTargetOptions();
			renderFileList();
			renderDiff();
			break;
		case 'diff':
			if (message.uri !== selectedFileUri) {
				return;
			}
			currentHunks = message.hunks;
			selectedKeys = allLineKeys();
			renderDiff();
			break;
		case 'error':
			showError(message.message);
			break;
	}
});

post({ type: 'ready' });
