import type {
	BranchTreeItemDto,
	BranchesToExtensionMessage,
	ExtensionToBranchesMessage,
} from '../../src/shared/protocol/branches';
import { createTranslator } from '../../src/shared/localization';

const vscode = acquireVsCodeApi();
const text = createTranslator(navigator.language);

function post(message: BranchesToExtensionMessage): void {
	vscode.postMessage(message);
}

let branches: BranchTreeItemDto[] = [];
let emptyState: 'noRepository' | 'noCommits' | undefined;
let selectedName: string | undefined;
let selectedKind: BranchTreeItemDto['kind'] | undefined;
const collapsedFolders = new Set<string>();
const collapsedSections = new Set<BranchTreeItemDto['kind']>();

const root = document.getElementById('root')!;
root.innerHTML = `
	<div class="branch-shell">
		<nav class="action-rail">
			<button id="new-branch" title="${text('New branch from HEAD', '현재 브랜치에서 새 브랜치 만들기')}"><svg viewBox="0 0 20 20"><path d="M10 3v14M3 10h14"/></svg></button>
			<button id="fetch" title="Fetch"><svg viewBox="0 0 20 20"><path d="M16.5 7A7 7 0 1 0 17 11"/><path d="M13 7h3.5V3.5"/></svg></button>
			<button id="update-selected" title="${text('Update selected branch', '선택 항목 업데이트')}"><svg viewBox="0 0 20 20"><path d="M10 3v9M6.5 9.5 10 13l3.5-3.5M4 16.5h12"/></svg></button>
			<button id="delete-selected" title="${text('Delete selected branch or tag', '선택한 브랜치 또는 태그 삭제')}"><svg viewBox="0 0 20 20"><path d="M4 6h12M8 3h4l1 3H7l1-3ZM6 6l1 11h6l1-11M9 9v5M11 9v5"/></svg></button>
			<button id="toggle-search" title="${text('Search branches', '브랜치 검색')}"><svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.2 12.2 4.3 4.3"/></svg></button>
		</nav>
		<main class="branch-main">
			<div class="search-box" id="search-box"><input id="branch-search" placeholder="${text('Search branches and tags', '브랜치 및 태그 검색')}"></div>
			<div class="head-row" id="head-row"></div>
			<div class="loading" id="loading"></div>
			<div class="tree" id="tree"></div>
		</main>
	</div>
`;

const style = document.createElement('style');
style.textContent = `
	html, body, #root { height: 100%; overflow: hidden; }
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); margin: 0; }
	.branch-shell { display: grid; grid-template-columns: 28px minmax(0, 1fr); height: 100%; min-height: 0; }
	.action-rail { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 7px 0; border-right: 1px solid var(--vscode-panel-border); }
	.action-rail button { display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px; margin: 0; padding: 0; border: 0; color: var(--vscode-icon-foreground); background: transparent; cursor: pointer; border-radius: 3px; }
	.action-rail button svg { display: block; width: 18px; height: 18px; overflow: visible; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
	.action-rail button:hover { background: var(--vscode-toolbar-hoverBackground); }
	.branch-main { min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; padding: 7px 8px 0; overflow: hidden; }
	.search-box { display: none; margin-bottom: 6px; }
	.search-box.visible { display: block; }
	.search-box input { width: 100%; padding: 5px 7px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); outline: 0; }
	.search-box input:focus { border-color: var(--vscode-focusBorder); }
	.head-row { flex: 0 0 auto; padding: 8px 12px; margin-bottom: 5px; border-radius: 5px; background: var(--vscode-list-inactiveSelectionBackground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.loading { min-height: 18px; opacity: 0.7; font-size: 0.85em; }
	.tree { flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-bottom: 12px; }
	.empty-state { padding: 12px 8px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
	.section-label { display: flex; align-items: center; gap: 5px; padding: 5px 5px 3px; font-weight: 600; font-size: 13px; cursor: pointer; }
	.section-label:hover { background: var(--vscode-list-hoverBackground); }
	.section-label .section-chevron { flex: 0 0 16px; width: 16px; height: 16px; color: var(--vscode-icon-foreground); opacity: 0.9; }
	.section-label .section-chevron svg { display: block; width: 16px; height: 16px; }
	.section-label.collapsed .section-chevron svg { transform: rotate(-90deg); }
	.row { display: flex; align-items: center; gap: 5px; min-height: 30px; padding: 2px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; }
	.row:hover { background: var(--vscode-list-hoverBackground); }
	.row.selected { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
	.row.current { font-weight: 600; color: var(--vscode-gitDecoration-addedResourceForeground); }
	.row .chevron { flex: 0 0 16px; width: 16px; height: 16px; color: var(--vscode-icon-foreground); opacity: 0.9; }
	.row .chevron svg { display: block; width: 16px; height: 16px; }
	.row .chevron.collapsed svg { transform: rotate(-90deg); }
	.row .icon { display: grid; place-items: center; flex: 0 0 16px; width: 16px; height: 16px; opacity: 0.85; }
	.row .icon svg { display: block; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
	.row.current .icon { opacity: 1; }
	.row .name { overflow: hidden; text-overflow: ellipsis; }
	.row .sync-counts { display: inline-flex; flex: 0 0 auto; gap: 6px; margin-left: 2px; font-size: 12px; font-weight: 600; }
	.row .sync-counts .behind { color: #4da3ff; }
	.row .sync-counts .ahead { color: var(--vscode-gitDecoration-addedResourceForeground, #55b56a); }
	.row .checkout { display: none; margin-left: auto; padding: 1px 6px; }
	.row:hover .checkout, .row:focus-within .checkout { display: inline-block; }
	.error-banner { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); padding: 4px 8px; }
	.context-menu { position: fixed; z-index: 20; min-width: 210px; padding: 4px 0; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 4px; color: var(--vscode-menu-foreground, var(--vscode-foreground)); background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 3px 10px #0007; }
	.context-item { padding: 6px 22px; cursor: default; white-space: nowrap; }
	.context-item:hover { color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground)); background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground)); }
	.context-separator { height: 1px; margin: 4px 0; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); }
`;
document.head.appendChild(style);

const treeEl = document.getElementById('tree')!;
const loadingEl = document.getElementById('loading')!;
const headEl = document.getElementById('head-row')!;
const searchBoxEl = document.getElementById('search-box')!;
const searchEl = document.getElementById('branch-search') as HTMLInputElement;
document.getElementById('fetch')!.addEventListener('click', () => post({ type: 'fetch' }));
document.getElementById('new-branch')!.addEventListener('click', () => post({ type: 'createBranch', from: branches.find((branch) => branch.isCurrent)?.name ?? 'HEAD' }));
function requireSelection(): { name: string; kind: BranchTreeItemDto['kind'] } | undefined {
	if (selectedName && selectedKind) return { name: selectedName, kind: selectedKind };
	showError(text('Select a branch or tag first.', '먼저 브랜치 또는 태그를 선택하세요.'));
	return undefined;
}
document.getElementById('update-selected')!.addEventListener('click', () => { const value = requireSelection(); if (value) post({ type: 'updateRef', ...value }); });
document.getElementById('delete-selected')!.addEventListener('click', () => {
	const value = requireSelection();
	if (value && value.kind !== 'remote') post({ type: 'deleteRef', kind: value.kind, name: value.name });
	else if (value) showError(text('Delete remote branches from their context menu.', '원격 브랜치는 우클릭 메뉴에서 삭제하세요.'));
});
document.getElementById('toggle-search')!.addEventListener('click', () => { searchBoxEl.classList.toggle('visible'); if (searchBoxEl.classList.contains('visible')) searchEl.focus(); });
searchEl.addEventListener('input', render);

interface TreeNode {
	readonly name: string;
	fullName?: string;
	isCurrent?: boolean;
	kind?: BranchTreeItemDto['kind'];
	ahead?: number;
	behind?: number;
	readonly children: Map<string, TreeNode>;
}

function insert(sectionRoot: TreeNode, branch: BranchTreeItemDto): void {
	const parts = branch.name.split('/');
	let node = sectionRoot;
	parts.forEach((part, i) => {
		let child = node.children.get(part);
		if (!child) {
			child = { name: part, children: new Map() };
			node.children.set(part, child);
		}
		node = child;
		if (i === parts.length - 1) {
			node.fullName = branch.name;
			node.isCurrent = branch.isCurrent;
			node.kind = branch.kind;
			node.ahead = branch.ahead;
			node.behind = branch.behind;
		}
	});
}

function renderNode(node: TreeNode, path: string, depth: number, container: HTMLElement): void {
	const isLeaf = node.fullName !== undefined;
	const hasChildren = node.children.size > 0;

	const row = document.createElement('div');
	row.className = 'row' + (node.isCurrent ? ' current' : '') + (isLeaf && node.fullName === selectedName ? ' selected' : '');
	row.style.paddingLeft = `${8 + depth * 14}px`;

	const chevron = document.createElement('span');
	chevron.className = 'chevron';
	if (hasChildren) {
		if (collapsedFolders.has(path)) chevron.classList.add('collapsed');
		chevron.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.97 5.72a.75.75 0 0 1 1.06 0L8 8.69l2.97-2.97a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 0-1.06Z"/></svg>';
	}
	row.appendChild(chevron);

	const icon = document.createElement('span');
	icon.className = 'icon';
	if (isLeaf) {
		icon.innerHTML = node.kind === 'tag'
			? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 3.25v4.2l5.8 5.8a1.7 1.7 0 0 0 2.4 0l2.3-2.3a1.7 1.7 0 0 0 0-2.4l-5.8-5.8h-4.7Z"/><circle cx="5.25" cy="5.25" r="1"/></svg>'
			: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="3.5" r="1.75"/><circle cx="5" cy="12.5" r="1.75"/><circle cx="11.5" cy="5.5" r="1.75"/><path d="M5 5.25v5.5M11.5 7.25v.5A4.75 4.75 0 0 1 6.75 12.5"/></svg>';
	} else {
		icon.textContent = collapsedFolders.has(path) ? '📁' : '📂';
	}
	row.appendChild(icon);

	const name = document.createElement('span');
	name.className = 'name';
	name.textContent = node.name;
	row.appendChild(name);
	if (isLeaf && ((node.behind ?? 0) > 0 || (node.ahead ?? 0) > 0)) {
		const sync = document.createElement('span');
		sync.className = 'sync-counts';
		if ((node.behind ?? 0) > 0) {
			const behind = document.createElement('span');
			behind.className = 'behind';
			behind.textContent = `↙ ${node.behind}`;
			behind.title = text(`${node.behind} commits to pull`, `Pull 받을 커밋 ${node.behind}개`);
			sync.appendChild(behind);
		}
		if ((node.ahead ?? 0) > 0) {
			const ahead = document.createElement('span');
			ahead.className = 'ahead';
			ahead.textContent = `↗ ${node.ahead}`;
			ahead.title = text(`${node.ahead} commits to push`, `Push할 커밋 ${node.ahead}개`);
			sync.appendChild(ahead);
		}
		row.appendChild(sync);
	}

	if (isLeaf) {
		row.addEventListener('click', (event) => { event.stopPropagation(); selectedName = node.fullName; selectedKind = node.kind; render(); });
		row.title = `${node.fullName}\n${text('Double-click to filter Git Graph', '더블클릭하면 Git 그래프에 이 브랜치만 표시합니다')}`;
		row.addEventListener('dblclick', () => post({ type: 'filterGraph', name: node.fullName! }));
		row.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			showContextMenu(event.clientX, event.clientY, node.fullName!, node.kind!, Boolean(node.isCurrent));
		});
		if (!node.isCurrent) {
			const checkout = document.createElement('button');
			checkout.className = 'checkout';
			checkout.textContent = text('Checkout', '체크아웃');
			checkout.addEventListener('click', (event) => {
				event.stopPropagation();
				post({ type: 'checkout', name: node.fullName!, kind: node.kind });
			});
			row.appendChild(checkout);
		}
	}
	if (hasChildren) {
		row.addEventListener('click', () => {
			if (collapsedFolders.has(path)) {
				collapsedFolders.delete(path);
			} else {
				collapsedFolders.add(path);
			}
			render();
		});
	}

	container.appendChild(row);

	if (hasChildren && !collapsedFolders.has(path)) {
		for (const child of node.children.values()) {
			renderNode(child, `${path}/${child.name}`, depth + 1, container);
		}
	}
}

function showContextMenu(x: number, y: number, name: string, kind: BranchTreeItemDto['kind'], isCurrent: boolean): void {
	document.querySelector('.context-menu')?.remove();
	const menu = document.createElement('div');
	menu.className = 'context-menu';
	const addItem = (label: string, action: () => void): void => {
		const item = document.createElement('div');
		item.className = 'context-item';
		item.textContent = label;
		item.addEventListener('click', () => { menu.remove(); action(); });
		menu.appendChild(item);
	};
	if (!isCurrent) addItem(text('Checkout', '체크아웃'), () => post({ type: 'checkout', name, kind }));
	if (kind === 'local') addItem(text('Push…', '푸시…'), () => post({ type: 'pushBranch', name }));
	const suggestedName = kind === 'remote' ? name.split('/').slice(1).join('/') : undefined;
	addItem(text('New Branch from Here…', '여기에서 새 브랜치 만들기…'), () => post({ type: 'createBranch', from: name, suggestedName }));
	addItem(text('Create Tag Here…', '여기에 태그 만들기…'), () => post({ type: 'createTag', ref: name }));
	if ((kind === 'local' && !isCurrent) || kind === 'remote' || kind === 'tag') {
		const separator = document.createElement('div'); separator.className = 'context-separator'; menu.appendChild(separator);
		const label = kind === 'tag'
			? text('Delete Tag…', '태그 삭제…')
			: kind === 'remote'
				? text('Delete Remote Branch…', '원격 브랜치 삭제…')
				: text('Delete Branch…', '브랜치 삭제…');
		addItem(label, () => post({ type: 'deleteRef', kind, name }));
	}
	document.body.appendChild(menu);
	const rect = menu.getBoundingClientRect();
	menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
	menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
}

function closeContextMenu(): void { document.querySelector('.context-menu')?.remove(); }
document.addEventListener('pointerdown', (event) => {
	const menu = document.querySelector('.context-menu');
	if (menu && !menu.contains(event.target as Node)) closeContextMenu();
}, true);
document.addEventListener('contextmenu', (event) => {
	if (!(event.target as Element).closest('.row')) closeContextMenu();
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeContextMenu(); });
window.addEventListener('scroll', closeContextMenu, true);
window.addEventListener('blur', closeContextMenu);

const SECTIONS: { kind: BranchTreeItemDto['kind']; label: string }[] = [
	{ kind: 'local', label: text('Local', '로컬') },
	{ kind: 'remote', label: text('Remote', '원격') },
	{ kind: 'tag', label: text('Tags', '태그') },
];

function render(): void {
	treeEl.innerHTML = '';
	if (branches.length === 0 && emptyState) {
		headEl.textContent = emptyState === 'noRepository'
			? text('No Git repository', 'Git 저장소 없음')
			: text('No commits yet', '아직 커밋 없음');
		const empty = document.createElement('div');
		empty.className = 'empty-state';
		empty.textContent = emptyState === 'noRepository'
			? text('Open a folder containing a Git repository.', 'Git 저장소가 있는 폴더를 여세요.')
			: text('Create the first commit to start using branches.', '첫 커밋을 만들면 브랜치를 사용할 수 있습니다.');
		treeEl.appendChild(empty);
		return;
	}
	const current = branches.find((branch) => branch.isCurrent);
	headEl.textContent = current ? `★  HEAD (${text('current branch', '현재 브랜치')}): ${current.name}` : `HEAD (${text('detached or unavailable', '분리됨 또는 확인 불가')})`;
	const query = searchEl.value.trim().toLocaleLowerCase();
	for (const section of SECTIONS) {
		const items = branches.filter((b) => b.kind === section.kind && (!query || b.name.toLocaleLowerCase().includes(query)));
		if (items.length === 0) {
			continue;
		}

		const label = document.createElement('div');
		label.className = 'section-label' + (collapsedSections.has(section.kind) ? ' collapsed' : '');
		label.innerHTML = '<span class="section-chevron"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.97 5.72a.75.75 0 0 1 1.06 0L8 8.69l2.97-2.97a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 0-1.06Z"/></svg></span>';
		const labelText = document.createElement('span');
		labelText.textContent = section.label;
		label.appendChild(labelText);
		label.addEventListener('click', () => {
			if (collapsedSections.has(section.kind)) collapsedSections.delete(section.kind);
			else collapsedSections.add(section.kind);
			render();
		});
		treeEl.appendChild(label);
		if (collapsedSections.has(section.kind)) continue;

		const sectionRoot: TreeNode = { name: '', children: new Map() };
		items.forEach((branch) => insert(sectionRoot, branch));
		for (const child of sectionRoot.children.values()) {
			renderNode(child, `${section.kind}/${child.name}`, 0, treeEl);
		}
	}
}

function showError(message: string): void {
	const banner = document.createElement('div');
	banner.className = 'error-banner';
	banner.textContent = message;
	root.prepend(banner);
	setTimeout(() => banner.remove(), 5000);
}

window.addEventListener('message', (event: MessageEvent<ExtensionToBranchesMessage>) => {
	const message = event.data;
	switch (message.type) {
		case 'branches':
			branches = message.branches;
			emptyState = message.emptyState;
			render();
			break;
		case 'busy':
			loadingEl.textContent = message.busy ? text('Loading…', '불러오는 중…') : '';
			break;
		case 'error':
			showError(message.message);
			break;
	}
});

post({ type: 'ready' });
