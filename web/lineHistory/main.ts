import { createTranslator } from '../../src/shared/localization';
import type { DiffHunk, DiffLine } from '../../src/shared/protocol/diff';
import type {
	ExtensionToLineHistoryMessage,
	LineHistoryCommitDto,
	LineHistoryToExtensionMessage,
	LineHistoryViewDto,
} from '../../src/shared/protocol/lineHistory';

const vscode = acquireVsCodeApi();
const text = createTranslator(navigator.language);
const root = document.getElementById('root')!;
let history: LineHistoryViewDto | undefined;
let selectedCommitHash: string | undefined;
let currentPreview: { oldContent: string; content: string; hunks: readonly DiffHunk[] } | undefined;
let diffEl: HTMLElement | undefined;
let oldRevisionEl: HTMLElement | undefined;
let newRevisionEl: HTMLElement | undefined;
let commitMessageEl: HTMLElement | undefined;
let changeIndex = 0;
const DIFF_LAYOUT_KEY = 'gitvisual.lineHistory.diffLayout';
let diffLayout: 'sideBySide' | 'stacked' = localStorage.getItem(DIFF_LAYOUT_KEY) === 'stacked' ? 'stacked' : 'sideBySide';

function post(message: LineHistoryToExtensionMessage): void { vscode.postMessage(message); }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function short(hash?: string): string { return hash?.slice(0, 8) ?? text('Initial', '최초 버전'); }

const style = document.createElement('style');
style.textContent = `
	* { box-sizing: border-box; }
	html, body { height: 100%; }
	body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
	.layout { display: flex; flex-direction: column; height: 100vh; padding: 10px 14px 14px; gap: 8px; }
	.title-row { display: flex; align-items: baseline; gap: 9px; min-height: 24px; }
	h1 { margin: 0; font-size: 16px; font-weight: 600; }
	.path, .range, .muted { color: var(--vscode-descriptionForeground); }
	.path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.preview-pane { display: flex; flex: 1 1 auto; min-width: 0; min-height: 250px; overflow: hidden; flex-direction: column; border: 1px solid var(--vscode-panel-border); }
	.preview-toolbar { display: flex; align-items: center; gap: 5px; min-height: 37px; padding: 4px 8px; overflow-x: auto; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editorGroupHeader-tabsBackground); white-space: nowrap; }
	.preview-toolbar button { flex: 0 0 auto; width: 28px; height: 26px; padding: 0; border: 0; color: var(--vscode-icon-foreground); background: transparent; font-size: 18px; cursor: pointer; }
	.preview-toolbar button:hover { background: var(--vscode-toolbar-hoverBackground); }
	.preview-toolbar .layout-button { width: auto; padding: 0 9px; font-size: 12px; }
	.preview-toolbar .layout-button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
	.preview-toolbar .difference-count { margin-left: auto; }
	.revision { min-width: 0; overflow: hidden; padding: 5px 9px; color: var(--vscode-descriptionForeground); text-overflow: ellipsis; white-space: nowrap; }
	.diff { display: grid; flex: 1 1 auto; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); width: 100%; min-height: 0; overflow: hidden; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.45; }
	.diff.stacked { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
	.diff-section { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
	.diff-section + .diff-section { border-left: 1px solid var(--vscode-panel-border); }
	.diff.stacked .diff-section + .diff-section { border-top: 1px solid var(--vscode-panel-border); border-left: 0; }
	.diff-section > .revision { flex: 0 0 auto; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editorGroupHeader-tabsBackground); }
	.diff-side { min-width: 0; min-height: 0; overflow: auto; }
	.diff-content { display: grid; width: max-content; min-width: 100%; }
	.diff-row { width: 100%; min-width: 100%; }
	.diff-cell { display: grid; grid-template-columns: 48px max-content; width: 100%; min-height: 20px; }
	.diff-cell.add { background: var(--vscode-diffEditor-insertedLineBackground, rgba(46,160,67,.16)); }
	.diff-cell.del { background: var(--vscode-diffEditor-removedLineBackground, rgba(248,81,73,.16)); }
	.diff-cell.empty { background: var(--vscode-diffEditor-diagonalFill, rgba(127,127,127,.06)); }
	.line-number { padding-right: 8px; color: var(--vscode-editorLineNumber-foreground); text-align: right; user-select: none; }
	.code { padding: 0 10px 0 7px; white-space: pre; }
	.hunk-header { width: max-content; min-width: 100%; padding: 4px 9px; color: var(--vscode-descriptionForeground); background: var(--vscode-diffEditor-unchangedRegionBackground, var(--vscode-editorGroupHeader-tabsBackground)); white-space: pre; }
	.preview-empty { padding: 32px 12px; color: var(--vscode-descriptionForeground); text-align: center; }
	.commit-pane { display: flex; flex: 0 0 250px; min-height: 160px; flex-direction: column; border: 1px solid var(--vscode-panel-border); }
	.commit-header, .commit-row { display: grid; grid-template-columns: 105px 190px 160px minmax(220px, 1fr) 76px; min-width: 760px; }
	.commit-header { flex: 0 0 auto; color: var(--vscode-descriptionForeground); background: var(--vscode-editorGroupHeader-tabsBackground); }
	.commit-header > span, .commit-row > span { overflow: hidden; padding: 5px 8px; border-right: 1px solid var(--vscode-panel-border); text-overflow: ellipsis; white-space: nowrap; }
	.commit-table { flex: 1 1 auto; min-height: 0; overflow: auto; }
	.commit-row { cursor: pointer; border-top: 1px solid var(--vscode-panel-border); }
	.commit-row:hover { background: var(--vscode-list-hoverBackground); }
	.commit-row.selected { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
	.commit-row button { margin: 2px 5px; border: 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
	.commit-message { flex: 0 0 42px; overflow: auto; padding: 5px 8px; border-top: 1px solid var(--vscode-panel-border); white-space: pre-wrap; }
	.error { padding: 7px 9px; color: var(--vscode-inputValidation-errorForeground); background: var(--vscode-inputValidation-errorBackground); }
	@media (max-width: 600px) {
		.layout { padding-right: 8px; padding-left: 8px; }
		.diff-cell { grid-template-columns: 36px minmax(max-content, 1fr); }
		.line-number { padding-right: 5px; }
		.code { padding-right: 6px; padding-left: 5px; }
	}
`;
document.head.appendChild(style);

interface PairRow {
	readonly oldLine?: DiffLine;
	readonly newLine?: DiffLine;
	readonly oldNumber?: number;
	readonly newNumber?: number;
	readonly oldContent?: string;
	readonly newContent?: string;
	readonly hunkIndex?: number;
	readonly header?: string;
}

function pairedHunk(hunk: DiffHunk, hunkIndex: number, includeHeader: boolean): PairRow[] {
	const rows: PairRow[] = includeHeader ? [{ header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.sectionHeading}`, hunkIndex }] : [];
	let deleted: DiffLine[] = [];
	let added: DiffLine[] = [];
	const flush = (): void => {
		const length = Math.max(deleted.length, added.length);
		for (let index = 0; index < length; index++) rows.push({ oldLine: deleted[index], newLine: added[index], hunkIndex });
		deleted = []; added = [];
	};
	for (const line of hunk.lines) {
		if (line.type === 'del') deleted.push(line);
		else if (line.type === 'add') added.push(line);
		else { flush(); rows.push({ oldLine: line, newLine: line, hunkIndex }); }
	}
	flush();
	return rows;
}

function fullFileRows(oldContent: string, newContent: string, hunks: readonly DiffHunk[]): PairRow[] {
	const oldLines = oldContent.split(/\r?\n/); if (oldLines.at(-1) === '') oldLines.pop();
	const newLines = newContent.split(/\r?\n/); if (newLines.at(-1) === '') newLines.pop();
	const rows: PairRow[] = [];
	let oldCursor = 0, newCursor = 0;
	for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
		const hunk = hunks[hunkIndex];
		while (oldCursor < Math.max(0, hunk.oldStart - 1) || newCursor < Math.max(0, hunk.newStart - 1)) {
			rows.push({ oldNumber: oldCursor + 1, newNumber: newCursor + 1, oldContent: oldLines[oldCursor++] ?? '', newContent: newLines[newCursor++] ?? '' });
		}
		rows.push(...pairedHunk(hunk, hunkIndex, false));
		oldCursor = Math.max(oldCursor, Math.max(0, hunk.oldStart - 1) + hunk.oldLines);
		newCursor = Math.max(newCursor, Math.max(0, hunk.newStart - 1) + hunk.newLines);
	}
	while (oldCursor < oldLines.length || newCursor < newLines.length) {
		rows.push({ oldNumber: oldCursor + 1, newNumber: newCursor + 1, oldContent: oldLines[oldCursor++] ?? '', newContent: newLines[newCursor++] ?? '' });
	}
	return rows;
}

function cell(number: number | undefined, content: string | undefined, kind?: 'add' | 'del'): HTMLElement {
	const element = document.createElement('div');
	element.className = `diff-cell${kind ? ` ${kind}` : ''}${content === undefined ? ' empty' : ''}`;
	const lineNumber = document.createElement('span'); lineNumber.className = 'line-number'; lineNumber.textContent = number ? String(number) : '';
	const code = document.createElement('span'); code.className = 'code'; code.textContent = content ?? '';
	element.append(lineNumber, code);
	return element;
}

function renderDiff(): void {
	if (!diffEl || !currentPreview) return;
	diffEl.innerHTML = '';
	const rows = history?.scope === 'file'
		? fullFileRows(currentPreview.oldContent, currentPreview.content, currentPreview.hunks)
		: currentPreview.hunks.flatMap((hunk, index) => pairedHunk(hunk, index, true));
	if (rows.length === 0) { diffEl.innerHTML = `<div class="preview-empty">${text('No textual changes found.', '텍스트 변경 사항을 찾지 못했습니다.')}</div>`; return; }
	diffEl.classList.toggle('stacked', diffLayout === 'stacked');
	const oldSide = document.createElement('div'); oldSide.className = 'diff-side diff-side-old';
	const newSide = document.createElement('div'); newSide.className = 'diff-side diff-side-new';
	const oldSection = document.createElement('section'); oldSection.className = 'diff-section';
	const newSection = document.createElement('section'); newSection.className = 'diff-section';
	const oldContent = document.createElement('div'); oldContent.className = 'diff-content';
	const newContent = document.createElement('div'); newContent.className = 'diff-content';
	let syncingScroll = false;
	const syncScroll = (source: HTMLElement, target: HTMLElement): void => {
		if (syncingScroll) return;
		syncingScroll = true;
		target.scrollTop = source.scrollTop;
		target.scrollLeft = source.scrollLeft;
		syncingScroll = false;
	};
	oldSide.addEventListener('scroll', () => syncScroll(oldSide, newSide));
	newSide.addEventListener('scroll', () => syncScroll(newSide, oldSide));
	let previousHunk: number | undefined;
	for (const row of rows) {
		const oldRow = document.createElement('div'); oldRow.className = 'diff-row';
		const newRow = document.createElement('div'); newRow.className = 'diff-row';
		if (row.header !== undefined) {
			for (const element of [oldRow, newRow]) { const header = document.createElement('div'); header.className = 'hunk-header'; header.textContent = row.header; element.appendChild(header); }
		}
		else {
			const oldKind = row.oldLine?.type === 'del' ? 'del' : undefined;
			const newKind = row.newLine?.type === 'add' ? 'add' : undefined;
			oldRow.appendChild(cell(row.oldLine?.oldLineNumber ?? row.oldNumber, row.oldLine?.content ?? row.oldContent, oldKind));
			newRow.appendChild(cell(row.newLine?.newLineNumber ?? row.newNumber, row.newLine?.content ?? row.newContent, newKind));
			if (row.hunkIndex !== undefined && row.hunkIndex !== previousHunk && (oldKind || newKind)) { oldRow.dataset.changeStart = 'true'; previousHunk = row.hunkIndex; }
		}
		oldContent.appendChild(oldRow); newContent.appendChild(newRow);
	}
	oldSide.appendChild(oldContent); newSide.appendChild(newContent);
	if (oldRevisionEl) oldSection.append(oldRevisionEl, oldSide); else oldSection.appendChild(oldSide);
	if (newRevisionEl) newSection.append(newRevisionEl, newSide); else newSection.appendChild(newSide);
	diffEl.append(oldSection, newSection);
	changeIndex = 0;
	requestAnimationFrame(() => navigateChange(0));
}

function navigateChange(delta: number): void {
	const changes = [...(diffEl?.querySelectorAll<HTMLElement>('[data-change-start="true"]') ?? [])];
	if (changes.length === 0) return;
	changeIndex = Math.max(0, Math.min(changes.length - 1, changeIndex + delta));
	const side = diffEl?.querySelector<HTMLElement>('.diff-side-old') ?? diffEl;
	if (side) side.scrollTop = Math.max(0, changes[changeIndex].offsetTop - side.clientHeight / 2);
}

function selectCommit(commit: LineHistoryCommitDto): void {
	selectedCommitHash = commit.hash;
	currentPreview = history?.scope === 'selection' ? { oldContent: '', content: '', hunks: commit.hunks } : undefined;
	for (const row of root.querySelectorAll<HTMLElement>('.commit-row')) row.classList.toggle('selected', row.dataset.hash === commit.hash);
	if (commitMessageEl) commitMessageEl.textContent = `${text('Commit Message', '커밋 메시지')}:\n${commit.subject || text('(no subject)', '(제목 없음)')}`;
	if (oldRevisionEl) oldRevisionEl.textContent = `${text('Before', '이전')} · ${short(commit.parents[0])}`;
	if (newRevisionEl) newRevisionEl.textContent = `${text('After', '변경 후')} · ${short(commit.hash)}`;
	if (history?.scope === 'file') {
		if (diffEl) diffEl.innerHTML = `<div class="preview-empty">${text('Loading diff…', 'Diff 불러오는 중…')}</div>`;
		post({ type: 'selectCommit', hash: commit.hash, parent: commit.parents[0] });
	} else renderDiff();
}

function openCommit(commit: LineHistoryCommitDto): void { post({ type: 'openCommit', hash: commit.hash, parent: commit.parents[0] }); }

function render(view: LineHistoryViewDto): void {
	history = view; root.innerHTML = '';
	const layout = document.createElement('main'); layout.className = 'layout';
	const titleRow = document.createElement('div'); titleRow.className = 'title-row';
	const title = document.createElement('h1'); title.textContent = view.scope === 'file' ? text('File History', '파일 기록') : text('Selection History', '선택 영역 기록');
	const range = document.createElement('span'); range.className = 'range'; range.textContent = view.scope === 'selection' ? `${view.startLine}–${view.endLine}` : '';
	const path = document.createElement('span'); path.className = 'path'; path.textContent = view.relativePath; path.title = view.relativePath;
	titleRow.append(title, range, path);

	const preview = document.createElement('section'); preview.className = 'preview-pane';
	diffEl = document.createElement('div'); diffEl.className = 'diff';
	const toolbar = document.createElement('div'); toolbar.className = 'preview-toolbar';
	const previous = document.createElement('button'); previous.textContent = '↑'; previous.title = text('Previous difference', '이전 차이'); previous.onclick = () => navigateChange(-1);
	const next = document.createElement('button'); next.textContent = '↓'; next.title = text('Next difference', '다음 차이'); next.onclick = () => navigateChange(1);
	const scope = document.createElement('span'); scope.className = 'muted'; scope.textContent = view.scope === 'file' ? text('Current file history', '현재 파일 전체 기록') : text('Selected lines only', '선택 범위 변경만 표시');
	const sideBySide = document.createElement('button'); sideBySide.className = 'layout-button'; sideBySide.textContent = text('Side by Side', '나란히 보기');
	const stacked = document.createElement('button'); stacked.className = 'layout-button'; stacked.textContent = text('Stacked', '위아래 보기');
	const updateLayout = (layout: 'sideBySide' | 'stacked', rerender = true): void => {
		diffLayout = layout; localStorage.setItem(DIFF_LAYOUT_KEY, layout);
		sideBySide.classList.toggle('active', layout === 'sideBySide'); stacked.classList.toggle('active', layout === 'stacked');
		if (rerender && currentPreview) renderDiff();
	};
	sideBySide.onclick = () => updateLayout('sideBySide'); stacked.onclick = () => updateLayout('stacked');
	updateLayout(diffLayout, false);
	const count = document.createElement('span'); count.className = 'difference-count muted'; count.textContent = `${view.commits.length} ${text('commits', '개 커밋')}`;
	toolbar.append(previous, next, scope, sideBySide, stacked, count);
	oldRevisionEl = document.createElement('div'); oldRevisionEl.className = 'revision';
	newRevisionEl = document.createElement('div'); newRevisionEl.className = 'revision';
	preview.append(toolbar, diffEl);

	const commitPane = document.createElement('section'); commitPane.className = 'commit-pane';
	const header = document.createElement('div'); header.className = 'commit-header';
	for (const value of [text('Version', '버전'), text('Date', '날짜'), text('Author', '작성자'), text('Commit Message', '커밋 메시지'), '']) { const span = document.createElement('span'); span.textContent = value; header.appendChild(span); }
	const table = document.createElement('div'); table.className = 'commit-table';
	for (const commit of view.commits) {
		const row = document.createElement('div'); row.className = 'commit-row'; row.dataset.hash = commit.hash; row.tabIndex = 0;
		for (const value of [short(commit.hash), formatDate(commit.date), commit.author, commit.subject || text('(no subject)', '(제목 없음)')]) { const span = document.createElement('span'); span.textContent = value; span.title = value; row.appendChild(span); }
		const button = document.createElement('button'); button.textContent = text('Full Diff', '전체 Diff'); button.onclick = (event) => { event.stopPropagation(); openCommit(commit); };
		row.appendChild(button); row.onclick = () => selectCommit(commit); row.ondblclick = () => openCommit(commit);
		row.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCommit(commit); } };
		table.appendChild(row);
	}
	commitMessageEl = document.createElement('div'); commitMessageEl.className = 'commit-message';
	commitPane.append(header, table, commitMessageEl);
	layout.append(titleRow, preview, commitPane); root.appendChild(layout);
	const initial = view.commits.find((commit) => commit.hash === selectedCommitHash) ?? view.commits[0];
	if (initial) selectCommit(initial); else if (diffEl) diffEl.innerHTML = `<div class="preview-empty">${text('No committed history was found.', '커밋 이력을 찾지 못했습니다.')}</div>`;
}

window.addEventListener('message', (event: MessageEvent<ExtensionToLineHistoryMessage>) => {
	const message = event.data;
	if (message.type === 'history') render(message.history);
	else if (message.type === 'commitDiff' && message.hash === selectedCommitHash) { currentPreview = message; renderDiff(); }
	else if (message.type === 'diffLoading' && message.hash === selectedCommitHash && diffEl) diffEl.innerHTML = `<div class="preview-empty">${text('Loading diff…', 'Diff 불러오는 중…')}</div>`;
	else if (message.type === 'error') { const error = document.createElement('div'); error.className = 'error'; error.textContent = message.message; root.prepend(error); }
});

post({ type: 'ready' });
