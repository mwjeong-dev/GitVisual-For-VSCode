import type {
	ChangedFileDto,
	ChangelistDto,
	ExtensionToWebviewMessage,
	WebviewToExtensionMessage,
} from '../../src/shared/protocol/commitPanel';
import { createTranslator } from '../../src/shared/localization';
import type { DiffHunk } from '../../src/shared/protocol/diff';

const vscode = acquireVsCodeApi();
const text = createTranslator(navigator.language);

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
let fileFilterQuery = '';
let statusFilter = 'all';
let selectedOnlyFilter = false;
const selectedFileUris = new Set<string>();
const knownFileUris = new Set<string>();
const COMMIT_BOX_HEIGHT_KEY = 'gitvisual.commitPanel.commitBoxHeight.v2';
let commitBoxHeight = Number(localStorage.getItem(COMMIT_BOX_HEIGHT_KEY) ?? '180');

const root = document.getElementById('root')!;
root.innerHTML = `
	<div class="layout">
		<div class="panel-toolbar">
			<button id="refresh-files" title="${text('Refresh changes', '변경 사항 새로고침')}">↻</button>
			<button id="expand-all" title="${text('Expand all', '모두 펼치기')}">↕</button>
			<button id="collapse-all" title="${text('Collapse all', '모두 접기')}">↥</button>
		</div>
		<div class="file-filter-bar">
			<input id="file-filter" type="search" placeholder="${text('Filter files or paths', '파일 또는 경로 검색')}" aria-label="${text('Filter files or paths', '파일 또는 경로 검색')}">
			<select id="status-filter" title="${text('Filter by status', '상태별 필터')}">
				<option value="all">${text('All statuses', '모든 상태')}</option>
				<option value="modified">${text('Modified', '수정됨')}</option>
				<option value="added">${text('Added', '추가됨')}</option>
				<option value="deleted">${text('Deleted', '삭제됨')}</option>
				<option value="renamed">${text('Renamed', '이름 변경됨')}</option>
				<option value="untracked">${text('Untracked', '추적 안 됨')}</option>
			</select>
			<button id="selected-only-filter" class="selected-only-filter" type="button" aria-pressed="false" title="${text('Show selected files only', '선택한 파일만 표시')}">${text('Selected', '선택됨')}</button>
			<span id="filter-summary" class="filter-summary"></span>
			<button id="clear-file-filter" class="filter-clear" type="button" title="${text('Clear filters', '필터 지우기')}" aria-label="${text('Clear filters', '필터 지우기')}">×</button>
		</div>
		<div class="file-list" id="file-list"></div>
		<div class="diff-view" id="diff-view"></div>
		<div class="commit-resizer" id="commit-resizer" title="${text('Drag to resize', '드래그하여 크기 조절')}"></div>
		<div class="commit-box" id="commit-box">
			<div class="commit-options"><label class="amend-row"><input type="checkbox" id="amend-checkbox"> ${text('Amend', '수정(M)')}</label><select id="commit-target"></select></div>
			<textarea id="commit-message" placeholder="${text('Commit message', '커밋 메시지')}"></textarea>
			<div class="commit-actions"><button id="commit-button">${text('Commit', '커밋(I)')}</button><button id="commit-push-button">${text('Commit and Push…', '커밋 및 푸시(P)…')}</button></div>
		</div>
	</div>
`;

const style = document.createElement('style');
style.textContent = `
	html, body { height: 100%; overflow-x: hidden; }
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0; margin: 0; }
	.layout { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

	.panel-toolbar { flex: 0 0 auto; display: flex; gap: 4px; align-items: center; min-height: 38px; padding: 3px 9px; border-bottom: 1px solid var(--vscode-panel-border); }
	.panel-toolbar button { width: 30px; height: 28px; padding: 0; color: var(--vscode-icon-foreground); background: transparent; font-size: 18px; }
	.panel-toolbar button:hover { background: var(--vscode-toolbar-hoverBackground); }
	.file-filter-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; min-height: 34px; padding: 3px 9px; border-bottom: 1px solid var(--vscode-panel-border); }
	.file-filter-bar input[type="search"] { flex: 1 1 180px; min-width: 80px; height: 24px; padding: 2px 7px; box-sizing: border-box; }
	.file-filter-bar select { flex: 0 1 116px; min-width: 76px; height: 24px; }
	.file-filter-bar button { flex: 0 0 auto; height: 24px; padding: 2px 7px; color: var(--vscode-foreground); background: transparent; }
	.file-filter-bar button:hover { background: var(--vscode-toolbar-hoverBackground); }
	.file-filter-bar .selected-only-filter[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
	.file-filter-bar .filter-summary { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; }
	.file-filter-bar .filter-clear { width: 24px; padding: 0; font-size: 17px; }
	.file-list { flex: 1 1 auto; min-height: 0; overflow: auto; border-bottom: 1px solid var(--vscode-panel-border); }
	.file-list-empty { padding: 18px 12px; color: var(--vscode-descriptionForeground); text-align: center; }

	.group-header { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 1px 10px; cursor: pointer; }
	.group-header:hover { background: var(--vscode-list-hoverBackground); }
	.group-header .chevron { flex: 0 0 16px; width: 16px; height: 16px; color: var(--vscode-icon-foreground); opacity: 0.9; }
	.group-header .chevron svg { display: block; width: 16px; height: 16px; }
	.group-header .chevron.collapsed svg { transform: rotate(-90deg); }
	.group-files.collapsed { display: none; }
	input[type="checkbox"] { appearance: none; -webkit-appearance: none; display: grid; place-content: center; flex: 0 0 auto; width: 16px; height: 16px; margin: 0; border: 1px solid var(--vscode-checkbox-border, var(--vscode-contrastBorder, #6b6b6b)); border-radius: 2px; background: var(--vscode-checkbox-background, var(--vscode-input-background)); cursor: pointer; }
	input[type="checkbox"]::before { content: ''; width: 8px; height: 4px; border: solid var(--vscode-checkbox-foreground, var(--vscode-foreground)); border-width: 0 0 2px 2px; transform: rotate(-45deg) translate(1px, -1px) scale(0); transform-origin: center; }
	input[type="checkbox"]:hover { border-color: var(--vscode-focusBorder); }
	input[type="checkbox"]:checked { border-color: var(--vscode-focusBorder); background: var(--vscode-checkbox-selectBackground, var(--vscode-focusBorder)); }
	input[type="checkbox"]:checked::before { transform: rotate(-45deg) translate(1px, -1px) scale(1); }
	input[type="checkbox"]:indeterminate::before { width: 8px; height: 2px; border: 0; background: var(--vscode-checkbox-foreground, var(--vscode-foreground)); transform: scale(1); }
	input[type="checkbox"]:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
	input[type="checkbox"]:disabled { cursor: default; opacity: 0.5; }
	.file-list input[type="checkbox"] { width: 14px; height: 14px; }
	.group-header > input[type="checkbox"] { width: 15px; height: 15px; }
	.group-header .group-label { font-weight: 600; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.group-header .group-label input { width: 100%; box-sizing: border-box; }
	.group-header .count { opacity: 0.65; font-size: 0.9em; flex: 0 0 auto; }
	.group-header .icon-button { flex: 0 0 auto; visibility: hidden; padding: 0 4px; line-height: 1; }
	.group-header:hover .icon-button { visibility: visible; }

	.new-changelist-row { padding: 3px 8px; opacity: 0.7; cursor: pointer; font-size: 0.9em; }
	.new-changelist-row:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
	.new-changelist-row input { width: 100%; box-sizing: border-box; }

	.file-item { display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 10px 0 53px; cursor: pointer; min-width: 0; box-sizing: border-box; }
	.file-item:hover { background: var(--vscode-list-hoverBackground); }
	.file-item.selected { background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-list-inactiveSelectionForeground, var(--vscode-list-activeSelectionForeground)); }
	.file-item.selected:hover { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
	.file-item .path { display: flex; align-items: baseline; gap: 8px; flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; }
	.file-item .name { flex: 0 0 auto; max-width: calc(100% - 24px); overflow: hidden; text-overflow: ellipsis; color: var(--vscode-foreground); font-size: 13px; }
	.file-item.untracked .name { color: var(--vscode-gitDecoration-untrackedResourceForeground); }
	.file-item.selected .name { color: inherit; }
	.file-item .dir { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); font-size: 12px; }
	.file-item .move-select { flex: 0 0 auto; visibility: hidden; max-width: 100px; font-size: 0.85em; }
	.file-item:hover .move-select, .file-item.selected .move-select { visibility: visible; }

	.diff-view { display: none; }
	.hunk-header { background: var(--vscode-diffEditor-unchangedRegionBackground, #3332); padding: 2px 6px; opacity: 0.8; white-space: nowrap; }
	.diff-line { display: flex; white-space: pre; padding: 0 6px; }
	.diff-line.add { background: var(--vscode-diffEditor-insertedTextBackground); }
	.diff-line.del { background: var(--vscode-diffEditor-removedTextBackground); }
	.diff-line input { margin-right: 6px; flex: 0 0 auto; }
	.diff-line .content { flex: 1 1 auto; }

	.commit-resizer { position: relative; z-index: 2; flex: 0 0 5px; cursor: row-resize; background: var(--vscode-panel-border); touch-action: none; }
	.commit-resizer::after { content: ''; position: absolute; inset: -3px 0; }
	.commit-resizer:hover, .commit-resizer.dragging { background: var(--vscode-focusBorder); }
	body.resizing-commit { cursor: row-resize; user-select: none; }
	.commit-box { flex: 0 0 180px; min-height: 130px; display: flex; flex-direction: column; padding: 7px 12px 10px; gap: 7px; box-sizing: border-box; }
	.commit-options { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
	.commit-options select { width: auto; border: 0; background: transparent; }
	.commit-actions { flex: 0 0 auto; display: flex; gap: 10px; }
	.commit-actions button { min-width: 108px; }
	.amend-row { display: flex; align-items: center; gap: 4px; font-size: 0.9em; cursor: pointer; }
	textarea, select, input[type="text"], input[type="search"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: inherit; }
	textarea { resize: none; flex: 1; min-height: 42px; padding: 8px; }
	button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; cursor: pointer; }
	button:hover { background: var(--vscode-button-hoverBackground); }
	.error-banner { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); padding: 4px 8px; }
	.context-menu { position: fixed; z-index: 30; display: flex; flex-direction: column; width: min(260px, calc(100vw - 12px)); padding: 5px; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 7px; color: var(--vscode-menu-foreground, var(--vscode-foreground)); background: var(--vscode-menu-background, #252526); box-shadow: 0 5px 18px #0009; }
	.context-item { padding: 5px 10px; border-radius: 4px; cursor: default; white-space: nowrap; font-size: 12px; }
	.context-item:hover { color: var(--vscode-menu-selectionForeground); background: var(--vscode-menu-selectionBackground); }
	.context-separator { height: 1px; margin: 4px 2px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); }
`;
document.head.appendChild(style);

const fileListEl = document.getElementById('file-list')!;
const fileFilterEl = document.getElementById('file-filter') as HTMLInputElement;
const statusFilterEl = document.getElementById('status-filter') as HTMLSelectElement;
const selectedOnlyFilterEl = document.getElementById('selected-only-filter') as HTMLButtonElement;
const filterSummaryEl = document.getElementById('filter-summary')!;
const clearFileFilterEl = document.getElementById('clear-file-filter') as HTMLButtonElement;
const diffViewEl = document.getElementById('diff-view')!;
const commitTargetEl = document.getElementById('commit-target') as HTMLSelectElement;
const commitMessageEl = document.getElementById('commit-message') as HTMLTextAreaElement;
const amendCheckboxEl = document.getElementById('amend-checkbox') as HTMLInputElement;
const commitButtonEl = document.getElementById('commit-button') as HTMLButtonElement;
const commitPushButtonEl = document.getElementById('commit-push-button') as HTMLButtonElement;
const commitBoxEl = document.getElementById('commit-box') as HTMLElement;
const commitResizerEl = document.getElementById('commit-resizer') as HTMLElement;

function applyCommitBoxHeight(height: number): void {
	// Keep only the fixed toolbar, filter bar, and resize handle above the
	// commit area. The file list may shrink to zero when the user explicitly
	// expands the message editor.
	const maxHeight = Math.max(130, window.innerHeight - 77);
	commitBoxHeight = Math.min(maxHeight, Math.max(130, height));
	commitBoxEl.style.flexBasis = `${commitBoxHeight}px`;
}

applyCommitBoxHeight(commitBoxHeight);
let resizeStartY = 0;
let resizeStartHeight = 0;
commitResizerEl.addEventListener('pointerdown', (event) => {
	event.preventDefault();
	resizeStartY = event.clientY;
	resizeStartHeight = commitBoxEl.getBoundingClientRect().height;
	commitResizerEl.setPointerCapture(event.pointerId);
	commitResizerEl.classList.add('dragging');
	document.body.classList.add('resizing-commit');
});
commitResizerEl.addEventListener('pointermove', (event) => {
	if (!commitResizerEl.hasPointerCapture(event.pointerId)) return;
	applyCommitBoxHeight(resizeStartHeight + resizeStartY - event.clientY);
});
const finishCommitResize = (event: PointerEvent): void => {
	if (commitResizerEl.hasPointerCapture(event.pointerId)) commitResizerEl.releasePointerCapture(event.pointerId);
	commitResizerEl.classList.remove('dragging');
	document.body.classList.remove('resizing-commit');
	localStorage.setItem(COMMIT_BOX_HEIGHT_KEY, String(commitBoxHeight));
};
commitResizerEl.addEventListener('pointerup', finishCommitResize);
commitResizerEl.addEventListener('pointercancel', finishCommitResize);
window.addEventListener('resize', () => applyCommitBoxHeight(commitBoxHeight));
document.getElementById('refresh-files')!.addEventListener('click', () => post({ type: 'refresh' }));
document.getElementById('expand-all')!.addEventListener('click', () => { collapsedGroups.clear(); renderFileList(); });
document.getElementById('collapse-all')!.addEventListener('click', () => { for (const group of buildGroups()) collapsedGroups.add(group.id); renderFileList(); });

let fileFilterTimer: number | undefined;
fileFilterEl.addEventListener('input', () => {
	window.clearTimeout(fileFilterTimer);
	fileFilterTimer = window.setTimeout(() => {
		fileFilterQuery = fileFilterEl.value.trim();
		renderFileList();
	}, 120);
});
statusFilterEl.addEventListener('change', () => {
	statusFilter = statusFilterEl.value;
	renderFileList();
});
selectedOnlyFilterEl.addEventListener('click', () => {
	selectedOnlyFilter = !selectedOnlyFilter;
	selectedOnlyFilterEl.setAttribute('aria-pressed', String(selectedOnlyFilter));
	renderFileList();
});
clearFileFilterEl.addEventListener('click', () => {
	fileFilterQuery = '';
	statusFilter = 'all';
	selectedOnlyFilter = false;
	fileFilterEl.value = '';
	statusFilterEl.value = 'all';
	selectedOnlyFilterEl.setAttribute('aria-pressed', 'false');
	renderFileList();
	fileFilterEl.focus();
});

function updateCommitButtons(): void {
	const count = selectedFileUris.size;
	commitButtonEl.textContent = count > 0 ? `${text('Commit', '커밋(I)')} (${count})` : text('Commit', '커밋(I)');
	commitPushButtonEl.textContent = count > 0 ? `${text('Commit and Push…', '커밋 및 푸시(P)…')} (${count})` : text('Commit and Push…', '커밋 및 푸시(P)…');
	commitButtonEl.disabled = count === 0;
	commitPushButtonEl.disabled = count === 0;
}

updateCommitButtons();

amendCheckboxEl.addEventListener('change', () => {
	if (amendCheckboxEl.checked && commitMessageEl.value.trim().length === 0) {
		commitMessageEl.value = lastCommitMessage;
	}
});

function submitCommit(push: boolean): void {
	const message = commitMessageEl.value;
	if (message.trim().length === 0 && !amendCheckboxEl.checked) {
		return;
	}
	const amend = amendCheckboxEl.checked;
	const uris = [...selectedFileUris];
	if (uris.length === 0) {
		return;
	}
	if (commitTargetEl.value === 'index') {
		post({ type: push ? 'commitAndPush' : 'commit', uris, message, amend });
	} else {
		post({ type: push ? 'commitChangelistAndPush' : 'commitChangelist', changelistId: commitTargetEl.value, uris, message, amend });
	}
	commitMessageEl.value = '';
	amendCheckboxEl.checked = false;
}
commitButtonEl.addEventListener('click', () => submitCommit(false));
commitPushButtonEl.addEventListener('click', () => submitCommit(true));

function renderCommitTargetOptions(): void {
	const previous = commitTargetEl.value;
	commitTargetEl.innerHTML = '';

	const indexOption = document.createElement('option');
	indexOption.value = 'index';
	indexOption.textContent = text('All Selected Changes', '선택한 모든 변경');
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
	readonly totalCount: number;
}

function globPattern(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
	return new RegExp(`^${escaped}$`, 'i');
}

function matchesFileFilters(file: ChangedFileDto): boolean {
	if (selectedOnlyFilter && !selectedFileUris.has(file.uri)) return false;
	const normalizedStatus = file.statusLabel.toLocaleLowerCase();
	if (statusFilter !== 'all' && normalizedStatus !== statusFilter) return false;
	const query = fileFilterQuery.toLocaleLowerCase();
	if (!query) return true;
	const normalizedPath = file.relPath.replace(/\\/g, '/').toLocaleLowerCase();
	const fileName = normalizedPath.split('/').at(-1) ?? normalizedPath;
	if (!/[*?]/.test(query)) return normalizedPath.includes(query);
	const pattern = globPattern(query);
	return pattern.test(normalizedPath) || pattern.test(fileName);
}

function buildGroups(): RenderGroup[] {
	const filterActive = Boolean(fileFilterQuery || statusFilter !== 'all' || selectedOnlyFilter);
	const groups: RenderGroup[] = changelists.flatMap((changelist) => {
		const allFiles = files.filter((file) => !file.isUntracked && file.changelistId === changelist.id);
		const matchingFiles = allFiles.filter(matchesFileFilters);
		if (filterActive && matchingFiles.length === 0) return [];
		return [{ id: changelist.id, label: changelist.name, files: matchingFiles, totalCount: allFiles.length, changelistId: changelist.id, isDefault: changelist.isDefault }];
	});
	const unversioned = files.filter((f) => f.isUntracked);
	const matchingUnversioned = unversioned.filter(matchesFileFilters);
	if (matchingUnversioned.length > 0) {
		groups.push({ id: 'unversioned', label: text('Unversioned Files', '버전이 없는 파일'), files: matchingUnversioned, totalCount: unversioned.length });
	}
	return groups;
}

function updateGroupCheckbox(fileContainer: HTMLElement): void {
	const groupCheckbox = fileContainer.previousElementSibling?.querySelector<HTMLInputElement>(
		'.group-header > input[type="checkbox"]',
	);
	if (!groupCheckbox) {
		return;
	}
	const fileCheckboxes = [...fileContainer.querySelectorAll<HTMLInputElement>('.file-item > input[type="checkbox"]')];
	const checkedCount = fileCheckboxes.filter((checkbox) => checkbox.checked).length;
	groupCheckbox.checked = fileCheckboxes.length > 0 && checkedCount === fileCheckboxes.length;
	groupCheckbox.indeterminate = checkedCount > 0 && checkedCount < fileCheckboxes.length;
}

function closeFileContextMenu(): void { document.querySelector('.context-menu')?.remove(); }

function showFileContextMenu(x: number, y: number, file: ChangedFileDto): void {
	closeFileContextMenu();
	const menu = document.createElement('div'); menu.className = 'context-menu';
	const item = (english: string, korean: string, action: () => void): void => {
		const row = document.createElement('div'); row.className = 'context-item'; row.textContent = text(english, korean);
		row.addEventListener('click', () => { closeFileContextMenu(); action(); }); menu.appendChild(row);
	};
	item('Open File', '파일 열기', () => post({ type: 'openFile', uri: file.uri }));
	if (file.canRollback) item('Rollback…', '롤백…', () => post({ type: 'rollbackFile', uri: file.uri }));
	item('Copy Relative Path', '상대 경로 복사', () => post({ type: 'copyRelativePath', path: file.relPath }));
	const separator = document.createElement('div'); separator.className = 'context-separator'; menu.appendChild(separator);
	item('Reveal in File Explorer', '파일 탐색기에서 표시', () => post({ type: 'revealFileInOS', uri: file.uri }));
	document.body.appendChild(menu);
	const rect = menu.getBoundingClientRect();
	menu.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
	menu.style.top = `${Math.max(4, Math.min(y, innerHeight - rect.height - 4))}px`;
}

document.addEventListener('pointerdown', (event) => {
	const menu = document.querySelector('.context-menu');
	if (menu && !menu.contains(event.target as Node)) closeFileContextMenu();
}, true);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeFileContextMenu(); });
window.addEventListener('scroll', closeFileContextMenu, true);
window.addEventListener('blur', closeFileContextMenu);

function renderFileItem(file: ChangedFileDto, showMoveSelect: boolean): HTMLElement {
	const { name, dir } = splitPath(file.relPath);

	const item = document.createElement('div');
	item.className = 'file-item' + (file.uri === selectedFileUri ? ' selected' : '') + (file.isUntracked ? ' untracked' : '');
	item.title = `${file.relPath}\n${text('Right-click to reveal in File Explorer', '우클릭하여 파일 탐색기에서 위치 표시')}`;

	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.checked = selectedFileUris.has(file.uri);
	checkbox.addEventListener('click', (e) => e.stopPropagation());
	checkbox.addEventListener('change', () => {
		if (checkbox.checked) {
			selectedFileUris.add(file.uri);
		} else {
			selectedFileUris.delete(file.uri);
		}
		const fileContainer = item.parentElement;
		if (fileContainer) {
			updateGroupCheckbox(fileContainer);
		}
		updateCommitButtons();
		if (selectedOnlyFilter) renderFileList();
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
		select.title = text('Move to changelist', '변경 목록으로 이동');
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
		post({ type: 'openFileDiff', uri: file.uri });
	});
	item.addEventListener('contextmenu', (event) => {
		event.preventDefault();
		event.stopPropagation();
		showFileContextMenu(event.clientX, event.clientY, file);
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

function renderGroupHeader(group: RenderGroup, fileContainer: HTMLElement): HTMLElement {
	const header = document.createElement('div');
	header.className = 'group-header';

	const chevron = document.createElement('span');
	chevron.className = 'chevron';
	if (collapsedGroups.has(group.id)) {
		chevron.classList.add('collapsed');
	}
	chevron.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.97 5.72a.75.75 0 0 1 1.06 0L8 8.69l2.97-2.97a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 0-1.06Z"/></svg>';
	header.appendChild(chevron);

	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.checked = group.files.length > 0 && group.files.every((file) => selectedFileUris.has(file.uri));
	checkbox.indeterminate = !checkbox.checked && group.files.some((file) => selectedFileUris.has(file.uri));
	checkbox.addEventListener('click', (e) => e.stopPropagation());
	checkbox.addEventListener('change', () => {
		// File inclusion is local UI state; Git is touched only when committing.
		for (const fileCheckbox of fileContainer.querySelectorAll<HTMLInputElement>('.file-item > input[type="checkbox"]')) {
			fileCheckbox.checked = checkbox.checked;
		}
		checkbox.indeterminate = false;
		for (const file of group.files) {
			if (checkbox.checked) {
				selectedFileUris.add(file.uri);
			} else {
				selectedFileUris.delete(file.uri);
			}
		}
		updateCommitButtons();
		if (selectedOnlyFilter) renderFileList();
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
	count.textContent = group.files.length === group.totalCount
		? `${group.files.length} ${text(group.files.length === 1 ? 'file' : 'files', '개 파일')}`
		: `${group.files.length} / ${group.totalCount} ${text('files', '개 파일')}`;
	header.appendChild(count);

	if (group.changelistId && !group.isDefault) {
		const deleteButton = document.createElement('button');
		deleteButton.className = 'icon-button';
		deleteButton.textContent = '×';
		deleteButton.title = text('Delete Changelist', '변경 목록 삭제');
		deleteButton.addEventListener('click', (e) => {
			e.stopPropagation();
			post({ type: 'deleteChangelist', id: group.changelistId! });
		});
		header.appendChild(deleteButton);
	}

	header.addEventListener('click', () => {
		const isCollapsed = collapsedGroups.has(group.id);
		if (isCollapsed) {
			collapsedGroups.delete(group.id);
		} else {
			collapsedGroups.add(group.id);
		}
		chevron.classList.toggle('collapsed', !isCollapsed);
		fileContainer.classList.toggle('collapsed', !isCollapsed);
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
		input.placeholder = text('Changelist name', '변경 목록 이름');
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
	const groups = buildGroups();
	const visibleCount = groups.reduce((count, group) => count + group.files.length, 0);
	const filterActive = Boolean(fileFilterQuery || statusFilter !== 'all' || selectedOnlyFilter);
	filterSummaryEl.textContent = filterActive ? `${visibleCount} / ${files.length}` : `${files.length}`;
	clearFileFilterEl.style.visibility = filterActive ? 'visible' : 'hidden';
	if (filterActive && visibleCount === 0) {
		const empty = document.createElement('div');
		empty.className = 'file-list-empty';
		empty.textContent = text('No files match the current filters.', '현재 필터와 일치하는 파일이 없습니다.');
		fileListEl.appendChild(empty);
	}
	for (const group of groups) {
		const fileContainer = document.createElement('div');
		fileContainer.className = 'group-files';
		if (collapsedGroups.has(group.id)) {
			fileContainer.classList.add('collapsed');
		}
		for (const file of group.files) {
			fileContainer.appendChild(renderFileItem(file, group.changelistId !== undefined));
		}
		fileListEl.appendChild(renderGroupHeader(group, fileContainer));
		fileListEl.appendChild(fileContainer);
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
			const currentUris = new Set(files.map((file) => file.uri));
			for (const file of files) {
				knownFileUris.add(file.uri);
			}
			for (const uri of [...knownFileUris]) {
				if (!currentUris.has(uri)) {
					knownFileUris.delete(uri);
					selectedFileUris.delete(uri);
				}
			}
			changelists = message.changelists;
			lastCommitMessage = message.lastCommitMessage ?? '';
			if (selectedFileUri && !files.some((f) => f.uri === selectedFileUri)) {
				selectedFileUri = undefined;
				currentHunks = [];
			}
			renderCommitTargetOptions();
			updateCommitButtons();
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
