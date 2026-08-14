import type {
	ExtensionToGraphMessage,
	GraphCommitDetailsDto,
	GraphCommitDto,
	GraphToExtensionMessage,
} from '../../src/shared/protocol/graph';
import { layoutCommits } from './layout';
import { branchColorOffset, COL_WIDTH, renderGraphSvg, ROW_HEIGHT } from './render';
import { createTranslator } from '../../src/shared/localization';

const vscode = acquireVsCodeApi();
const post = (message: GraphToExtensionMessage): void => vscode.postMessage(message);
const text = createTranslator(navigator.language);

let commits: GraphCommitDto[] = [];
let selectedHash: string | undefined;
let selectedRef: string | undefined;
let refs: string[] = [];
const DETAILS_SPLIT_KEY = 'gitvisual.graph.detailsSplit';
let detailsSplit = Number(localStorage.getItem(DETAILS_SPLIT_KEY) ?? '0.65');
if (!Number.isFinite(detailsSplit)) detailsSplit = 0.65;
detailsSplit = Math.min(0.85, Math.max(0.2, detailsSplit));

const root = document.getElementById('root')!;
root.innerHTML = `
	<div class="shell">
		<div class="left-pane">
			<div class="toolbar">
				<div class="search-wrap"><span>⌕</span><input id="search" placeholder="${text('Search commits, authors, refs, or hashes', '커밋, 작성자, 브랜치 또는 해시 검색')}"></div>
				<div class="branch-filter" id="branch-filter"><button id="branch-button">${text('Branch', '브랜치')}⌄</button><button id="clear-branch" title="${text('Clear branch filter', '브랜치 필터 해제')}">×</button><div class="branch-menu" id="branch-menu"></div></div>
				<button id="refresh" title="Refresh">↻</button>
			</div>
			<div class="column-head"><span>${text('Commit', '커밋')}</span><span>${text('Author', '작성자')}</span><span>${text('Date', '날짜')}</span></div>
			<div class="graph-container" id="graph-container"><div class="graph-rows" id="graph-rows"></div></div>
		</div>
		<aside class="details" id="details"><div class="empty">${text('Select a commit to see its details', '상세 정보를 볼 커밋을 선택하세요')}</div></aside>
	</div>`;

const style = document.createElement('style');
style.textContent = `
	* { box-sizing: border-box; }
	html, body, #root { height: 100%; }
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0; margin: 0; overflow: hidden; }
	.shell { display: grid; grid-template-columns: minmax(480px, 2.2fr) minmax(280px, 1fr); height: 100%; min-height: 0; overflow: hidden; }
	.left-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--vscode-panel-border); }
	.toolbar { height: 38px; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
	.search-wrap { flex: 1; max-width: 440px; display: flex; align-items: center; gap: 6px; padding: 3px 8px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: var(--vscode-input-background); }
	.search-wrap:focus-within { border-color: var(--vscode-focusBorder); }
	.search-wrap input { width: 100%; border: 0; outline: 0; color: var(--vscode-input-foreground); background: transparent; font: inherit; }
	.toolbar button { margin-left: auto; border: 0; padding: 3px 8px; font-size: 17px; cursor: pointer; color: var(--vscode-foreground); background: transparent; }
	.branch-filter { position: relative; }
	.toolbar .branch-filter button { margin: 0; font-size: 13px; white-space: nowrap; }
	.toolbar .branch-filter #clear-branch { display: none; margin-left: -5px; padding-left: 3px; }
	.toolbar .branch-filter.active #clear-branch { display: inline-block; }
	.branch-filter.active button { color: var(--vscode-textLink-foreground); background: var(--vscode-list-hoverBackground); border-radius: 3px; }
	.branch-menu { display: none; position: absolute; z-index: 20; top: 30px; left: 0; min-width: 240px; max-height: 330px; overflow: auto; padding: 4px 0; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 4px 12px #0008; }
	.branch-menu.open { display: block; }
	.branch-option { padding: 6px 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.branch-option:hover { background: var(--vscode-list-hoverBackground); }
	.toolbar button:hover { background: var(--vscode-toolbar-hoverBackground); }
	.column-head { display: grid; grid-template-columns: minmax(240px, 1fr) 145px 130px; padding: 4px 12px 4px 54px; opacity: .65; font-size: 11px; border-bottom: 1px solid var(--vscode-panel-border); }
	.graph-container { position: relative; flex: 1 1 0; width: 100%; min-height: 0; overflow-x: auto; overflow-y: scroll; overscroll-behavior: contain; scrollbar-gutter: stable; }
	.graph-container svg { position: absolute; top: 0; left: 8px; pointer-events: none; }
	.graph-rows { position: relative; min-width: 580px; }
	.graph-row { display: grid; grid-template-columns: minmax(240px, 1fr) 145px 130px; align-items: center; white-space: nowrap; cursor: default; padding-right: 12px; border-bottom: 1px solid transparent; }
	.graph-row:hover { background: var(--vscode-list-hoverBackground); }
	.graph-row.selected { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
	.commit-cell { min-width: 0; display: flex; align-items: center; gap: 7px; overflow: hidden; }
	.subject { min-width: 40px; overflow: hidden; text-overflow: ellipsis; }
	.ref-badge { flex: 0 0 auto; max-width: 180px; overflow: hidden; text-overflow: ellipsis; font-size: 11px; padding: 1px 5px; border: 1px solid var(--vscode-gitDecoration-addedResourceForeground); border-radius: 9px; color: var(--vscode-gitDecoration-addedResourceForeground); }
	.ref-badge.remote { color: #c678dd; border-color: #c678dd; }
	.ref-badge.tag { color: #d6a84b; border-color: #d6a84b; }
	.ref-badge.head { color: #56b6c2; border-color: #56b6c2; }
	.author { overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
	.date { opacity: .8; overflow: hidden; text-overflow: ellipsis; }
	.details { min-width: 0; display: flex; flex-direction: column; overflow: auto; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
	.empty { margin: auto; opacity: .55; }
	.detail-header { flex: 1 1 0; min-height: 90px; overflow: auto; padding: 18px 20px 14px; }
	.detail-subject { font: 600 16px/1.4 var(--vscode-editor-font-family); margin-bottom: 14px; white-space: pre-wrap; }
	.detail-meta { color: var(--vscode-descriptionForeground); line-height: 1.6; overflow-wrap: anywhere; }
	.detail-meta code { color: var(--vscode-foreground); }
	.refs { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 5px; }
	.files { flex: 0 0 65%; min-height: 80px; overflow: auto; }
	.details-resizer { position: relative; z-index: 2; flex: 0 0 5px; cursor: row-resize; background: var(--vscode-panel-border); touch-action: none; }
	.details-resizer::after { content: ''; position: absolute; inset: -3px 0; }
	.details-resizer:hover, .details-resizer.dragging { background: var(--vscode-focusBorder); }
	body.resizing-details { cursor: row-resize; user-select: none; }
	.file-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; font-weight: 600; background: var(--vscode-sideBarSectionHeader-background); }
	.file-list { padding: 4px 0 12px; }
	.file-row, .file-folder { display: flex; align-items: center; gap: 5px; min-height: 30px; padding: 2px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; }
	.file-row:hover, .file-folder:hover { background: var(--vscode-list-hoverBackground); }
	.file-folder { color: var(--vscode-descriptionForeground); user-select: none; }
	.file-tree-chevron { flex: 0 0 16px; width: 16px; height: 16px; color: var(--vscode-icon-foreground); opacity: .9; }
	.file-tree-chevron svg { display: block; width: 16px; height: 16px; }
	.file-folder.collapsed .file-tree-chevron svg { transform: rotate(-90deg); }
	.file-tree-icon { display: grid; place-items: center; flex: 0 0 16px; width: 16px; height: 16px; opacity: .85; }
	.folder-children.collapsed { display: none; }
	.file-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.file-status { flex: 0 0 auto; margin-left: auto; font-weight: 700; color: var(--vscode-gitDecoration-modifiedResourceForeground); }
	.error-banner { position: absolute; z-index: 5; left: 8px; right: 8px; padding: 6px 10px; background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
	.context-menu { position: fixed; z-index: 30; display: flex; flex-direction: column; width: min(350px, calc(100vw - 12px)); padding: 5px; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 7px; color: var(--vscode-menu-foreground, var(--vscode-foreground)); background: var(--vscode-menu-background, #252526); box-shadow: 0 5px 18px #0009; }
	.context-title { padding: 3px 9px 2px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; }
	.context-item { padding: 4px 10px; border-radius: 4px; cursor: default; white-space: nowrap; font-size: 12px; line-height: 1.25; }
	.context-item:hover { color: var(--vscode-menu-selectionForeground); background: var(--vscode-menu-selectionBackground); }
	.context-separator { height: 1px; margin: 3px 2px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); }
	@media (max-width: 820px) { .shell { grid-template-columns: 1fr; grid-template-rows: 60% 40%; } .left-pane { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); } }
`;
document.head.appendChild(style);

const containerEl = document.getElementById('graph-container')!;
const rowsEl = document.getElementById('graph-rows')!;
const detailsEl = document.getElementById('details')!;
const searchEl = document.getElementById('search') as HTMLInputElement;
const branchFilterEl = document.getElementById('branch-filter')!;
const branchButtonEl = document.getElementById('branch-button') as HTMLButtonElement;
const clearBranchEl = document.getElementById('clear-branch') as HTMLButtonElement;
const branchMenuEl = document.getElementById('branch-menu')!;

// Chromium normally scrolls this element natively. Explicit handling keeps
// wheel scrolling reliable inside a VS Code webview when the graph is wider
// than the panel or an absolutely positioned SVG sits over the row area.
containerEl.addEventListener('wheel', (event) => {
	const lineHeight = ROW_HEIGHT;
	const pageHeight = Math.max(containerEl.clientHeight, lineHeight);
	const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
		? lineHeight
		: event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? pageHeight : 1;
	const deltaY = event.deltaY * scale;
	const deltaX = event.deltaX * scale;
	if (event.shiftKey && Math.abs(deltaY) > Math.abs(deltaX)) {
		containerEl.scrollLeft += deltaY;
	} else {
		containerEl.scrollTop += deltaY;
		containerEl.scrollLeft += deltaX;
	}
	if (deltaX !== 0 || deltaY !== 0) event.preventDefault();
}, { passive: false });

document.getElementById('refresh')!.addEventListener('click', () => post({ type: 'refresh' }));
searchEl.addEventListener('input', renderRows);
branchButtonEl.addEventListener('click', (event) => { event.stopPropagation(); branchMenuEl.classList.toggle('open'); });
clearBranchEl.addEventListener('click', (event) => {
	event.stopPropagation(); selectedRef = undefined; selectedHash = undefined; branchMenuEl.classList.remove('open'); renderBranchFilter(); post({ type: 'filterBranch' });
});
window.addEventListener('click', () => branchMenuEl.classList.remove('open'));

function renderBranchFilter(): void {
	branchFilterEl.classList.toggle('active', Boolean(selectedRef));
	branchButtonEl.textContent = selectedRef ? `${text('Branch', '브랜치')}: ${selectedRef}` : `${text('Branch', '브랜치')}⌄`;
	branchButtonEl.title = selectedRef ? text(`Filtering by ${selectedRef}. Choose All branches to clear.`, `${selectedRef} 브랜치로 필터링 중입니다. 전체 브랜치를 선택하면 해제됩니다.`) : text('Filter by branch', '브랜치로 필터링');
	branchMenuEl.innerHTML = '';
	const add = (label: string, ref?: string): void => {
		const option = document.createElement('div'); option.className = 'branch-option'; option.textContent = label;
		option.addEventListener('click', () => { selectedRef = ref; selectedHash = undefined; renderBranchFilter(); post({ type: 'filterBranch', ref }); });
		branchMenuEl.appendChild(option);
	};
	add(text('All branches', '전체 브랜치'));
	for (const ref of refs) add(ref, ref);
}

function formatDate(iso: string, includeTime = false): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return includeTime ? date.toLocaleString() : date.toLocaleDateString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' });
}

function matchingCommits(): GraphCommitDto[] {
	const query = searchEl.value.trim().toLocaleLowerCase();
	if (!query) return commits;
	return commits.filter((commit) => [commit.hash, commit.subject, commit.authorName, ...commit.refs].some((value) => value.toLocaleLowerCase().includes(query)));
}

function renderRows(): void {
	containerEl.querySelector('svg')?.remove();
	const layout = layoutCommits(matchingCommits());
	const svg = renderGraphSvg(layout, branchColorOffset(selectedRef));
	containerEl.insertBefore(svg, rowsEl);
	const graphWidth = Math.max(1, layout.laneCount) * COL_WIDTH + 16;
	rowsEl.style.paddingLeft = `${graphWidth}px`;
	rowsEl.innerHTML = '';
	for (const node of layout.nodes) {
		const row = document.createElement('div');
		row.className = `graph-row${node.hash === selectedHash ? ' selected' : ''}`;
		row.style.height = `${ROW_HEIGHT}px`;
		const commitCell = document.createElement('div');
		commitCell.className = 'commit-cell';
		const subject = document.createElement('span');
		subject.className = 'subject';
		subject.textContent = node.subject || text('(no subject)', '(제목 없음)');
		commitCell.appendChild(subject);
		for (const ref of node.refs) {
			const badge = document.createElement('span');
			badge.className = 'ref-badge';
			if (ref.startsWith('tag: ')) badge.classList.add('tag');
			else if (ref.startsWith('origin/')) badge.classList.add('remote');
			else if (ref.startsWith('HEAD')) badge.classList.add('head');
			badge.textContent = ref;
			badge.title = ref;
			commitCell.appendChild(badge);
		}
		const author = document.createElement('span'); author.className = 'author'; author.textContent = node.authorName;
		const date = document.createElement('span'); date.className = 'date'; date.textContent = formatDate(node.date);
		row.append(commitCell, author, date);
		row.title = `${node.hash}\n${node.subject}\n${node.authorName} · ${node.date}`;
		row.addEventListener('click', () => { selectedHash = node.hash; renderRows(); post({ type: 'selectCommit', hash: node.hash }); });
		row.addEventListener('contextmenu', (event) => { event.preventDefault(); selectedHash = node.hash; renderRows(); showCommitMenu(event.clientX, event.clientY, node.hash); });
		rowsEl.appendChild(row);
	}
}

type CommitAction = Extract<GraphToExtensionMessage, { type: 'commitAction' }>['action'];
function showCommitMenu(x: number, y: number, hash: string): void {
	closeCommitMenu();
	const menu = document.createElement('div'); menu.className = 'context-menu';
	const item = (english: string, korean: string, action: CommitAction): void => {
		const row = document.createElement('div'); row.className = 'context-item'; row.textContent = text(english, korean);
		row.addEventListener('click', () => { closeCommitMenu(); post({ type: 'commitAction', hash, action }); }); menu.appendChild(row);
	};
	const title = (english: string, korean: string): void => { const heading = document.createElement('div'); heading.className = 'context-title'; heading.textContent = text(english, korean); menu.appendChild(heading); };
	const separator = (): void => { const line = document.createElement('div'); line.className = 'context-separator'; menu.appendChild(line); };
	title('Revision', '리비전');
	item('Copy Revision Number', '리비전 번호 복사', 'copyHash');
	item('Create Patch…', '패치 생성…', 'createPatch');
	item('Cherry-Pick', 'Cherry-Pick', 'cherryPick');
	separator();
	item('Checkout Revision', '리비전 체크아웃', 'checkout');
	item('Compare with HEAD', '로컬과 비교', 'compareHead');
	separator();
	title('History', '이력 변경');
	item('Reset Current Branch to Here…', '현재 브랜치를 여기로 재설정…', 'reset');
	item('Revert Commit…', '커밋 되돌리기…', 'revert');
	separator();
	item('Edit Commit Message…', '커밋 메시지 편집…', 'editMessage');
	item('Create Fixup Commit', '픽스업…', 'fixup');
	item('Rebase Current Branch onto Here…', '현재 브랜치를 여기로 리베이스…', 'rebase');
	separator();
	title('Create', '새로 만들기');
	item('New Branch…', '새 브랜치…', 'newBranch');
	item('New Tag…', '새 태그…', 'newTag');
	document.body.appendChild(menu);
	const rect = menu.getBoundingClientRect();
	menu.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
	menu.style.top = `${Math.max(4, Math.min(y, innerHeight - rect.height - 4))}px`;
}
function closeCommitMenu(): void { document.querySelector('.context-menu')?.remove(); }
document.addEventListener('pointerdown', (event) => { const menu = document.querySelector('.context-menu'); if (menu && !menu.contains(event.target as Node)) closeCommitMenu(); }, true);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeCommitMenu(); });
window.addEventListener('scroll', closeCommitMenu, true);
window.addEventListener('blur', closeCommitMenu);

interface FileTreeNode {
	readonly folders: Map<string, FileTreeNode>;
	readonly files: GraphCommitDetailsDto['files'][number][];
}

function buildFileTree(files: GraphCommitDetailsDto['files']): FileTreeNode {
	const root: FileTreeNode = { folders: new Map(), files: [] };
	for (const file of files) {
		const parts = file.path.replace(/\\/g, '/').split('/').filter(Boolean);
		let node = root;
		for (const folder of parts.slice(0, -1)) {
			let child = node.folders.get(folder);
			if (!child) {
				child = { folders: new Map(), files: [] };
				node.folders.set(folder, child);
			}
			node = child;
		}
		node.files.push(file);
	}
	return root;
}

function renderFileTree(parent: HTMLElement, node: FileTreeNode, details: GraphCommitDetailsDto, depth = 0): void {
	const byName = (left: string, right: string): number => left.localeCompare(right, undefined, { sensitivity: 'base' });
	for (const [name, child] of [...node.folders].sort(([left], [right]) => byName(left, right))) {
		const folder = document.createElement('div');
		folder.className = 'file-folder';
		folder.style.paddingLeft = `${8 + depth * 14}px`;
		folder.title = name;
		const chevron = document.createElement('span'); chevron.className = 'file-tree-chevron';
		chevron.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.97 5.72a.75.75 0 0 1 1.06 0L8 8.69l2.97-2.97a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 0-1.06Z"/></svg>';
		const icon = document.createElement('span'); icon.className = 'file-tree-icon'; icon.textContent = '📂';
		const label = document.createElement('span'); label.className = 'file-path'; label.textContent = name;
		folder.append(chevron, icon, label);
		const children = document.createElement('div'); children.className = 'folder-children';
		renderFileTree(children, child, details, depth + 1);
		folder.addEventListener('click', () => {
			const collapsed = folder.classList.toggle('collapsed');
			children.classList.toggle('collapsed', collapsed);
			icon.textContent = collapsed ? '📁' : '📂';
		});
		parent.append(folder, children);
	}
	for (const file of [...node.files].sort((left, right) => byName(left.path, right.path))) {
		const name = file.path.replace(/\\/g, '/').split('/').at(-1) ?? file.path;
		const row = document.createElement('div'); row.className = 'file-row'; row.title = file.path;
		row.style.paddingLeft = `${8 + depth * 14}px`;
		const chevronSpace = document.createElement('span'); chevronSpace.className = 'file-tree-chevron';
		const iconSpace = document.createElement('span'); iconSpace.className = 'file-tree-icon';
		const path = document.createElement('span'); path.className = 'file-path'; path.textContent = name;
		const status = document.createElement('span'); status.className = 'file-status'; status.textContent = file.status.slice(0, 1);
		row.append(chevronSpace, iconSpace, path, status);
		row.addEventListener('click', () => post({ type: 'openFile', hash: details.hash, uri: file.uri }));
		parent.appendChild(row);
	}
}

function renderDetails(details: GraphCommitDetailsDto): void {
	detailsEl.innerHTML = '';
	const header = document.createElement('div'); header.className = 'detail-header';
	const subject = document.createElement('div'); subject.className = 'detail-subject'; subject.textContent = details.message;
	const meta = document.createElement('div'); meta.className = 'detail-meta';
	meta.innerHTML = `<code>${details.hash.slice(0, 8)}</code> · ${formatDate(details.date, true)}<br>`;
	const author = document.createElement('span'); author.textContent = `${details.authorName}${details.authorEmail ? ` <${details.authorEmail}>` : ''}`; meta.appendChild(author);
	header.append(subject, meta);
	if (details.refs.length) {
		const refs = document.createElement('div'); refs.className = 'refs';
		for (const ref of details.refs) { const badge = document.createElement('span'); badge.className = 'ref-badge'; badge.textContent = ref; refs.appendChild(badge); }
		header.appendChild(refs);
	}
	const fileHead = document.createElement('div'); fileHead.className = 'file-head';
	const count = document.createElement('span'); count.textContent = `${details.files.length} ${text(details.files.length === 1 ? 'changed file' : 'changed files', '개의 변경된 파일')}`;
	fileHead.append(count);
	const list = document.createElement('div'); list.className = 'file-list';
	renderFileTree(list, buildFileTree(details.files), details);
	const files = document.createElement('div'); files.className = 'files'; files.append(fileHead, list);
	files.style.flexBasis = `${detailsSplit * 100}%`;
	const resizer = document.createElement('div');
	resizer.className = 'details-resizer';
	resizer.title = text('Drag to resize', '드래그하여 크기 조절');
	resizer.addEventListener('pointerdown', (event) => {
		event.preventDefault();
		resizer.setPointerCapture(event.pointerId);
		resizer.classList.add('dragging');
		document.body.classList.add('resizing-details');
	});
	resizer.addEventListener('pointermove', (event) => {
		if (!resizer.hasPointerCapture(event.pointerId)) return;
		const bounds = detailsEl.getBoundingClientRect();
		if (bounds.height <= 0) return;
		detailsSplit = Math.min(0.85, Math.max(0.2, (event.clientY - bounds.top) / bounds.height));
		files.style.flexBasis = `${detailsSplit * 100}%`;
	});
	const finishResize = (event: PointerEvent): void => {
		if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
		resizer.classList.remove('dragging');
		document.body.classList.remove('resizing-details');
		localStorage.setItem(DETAILS_SPLIT_KEY, String(detailsSplit));
	};
	resizer.addEventListener('pointerup', finishResize);
	resizer.addEventListener('pointercancel', finishResize);
	detailsEl.append(files, resizer, header);
}

function showError(message: string): void {
	const banner = document.createElement('div'); banner.className = 'error-banner'; banner.textContent = message; root.prepend(banner); setTimeout(() => banner.remove(), 5000);
}

window.addEventListener('message', (event: MessageEvent<ExtensionToGraphMessage>) => {
	const message = event.data;
	if (message.type === 'commits') {
		selectedRef = message.ref;
		renderBranchFilter();
		commits = message.commits;
		if (!selectedHash || !commits.some((commit) => commit.hash === selectedHash)) selectedHash = commits[0]?.hash;
		renderRows();
		if (selectedHash) post({ type: 'selectCommit', hash: selectedHash });
	} else if (message.type === 'commitDetails' && message.details.hash === selectedHash) {
		renderDetails(message.details);
	} else if (message.type === 'refs') {
		refs = message.refs;
		renderBranchFilter();
	} else if (message.type === 'error') {
		showError(message.message);
	}
});

post({ type: 'ready' });
