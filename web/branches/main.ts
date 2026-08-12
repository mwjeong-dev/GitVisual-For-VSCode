import type {
	BranchTreeItemDto,
	BranchesToExtensionMessage,
	ExtensionToBranchesMessage,
} from '../../src/shared/protocol/branches';

const vscode = acquireVsCodeApi();

function post(message: BranchesToExtensionMessage): void {
	vscode.postMessage(message);
}

let branches: BranchTreeItemDto[] = [];
const collapsedFolders = new Set<string>();

const root = document.getElementById('root')!;
root.innerHTML = `<div class="tree" id="tree"></div>`;

const style = document.createElement('style');
style.textContent = `
	html, body { height: 100%; overflow-x: hidden; }
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 4px 0; }
	.tree { overflow-y: auto; }
	.section-label { padding: 4px 8px 2px; font-weight: 600; opacity: 0.7; font-size: 0.85em; text-transform: uppercase; }
	.row { display: flex; align-items: center; gap: 4px; padding: 2px 8px; cursor: pointer; white-space: nowrap; overflow: hidden; }
	.row:hover { background: var(--vscode-list-hoverBackground); }
	.row.current { font-weight: 600; color: var(--vscode-gitDecoration-addedResourceForeground); }
	.row .chevron { flex: 0 0 auto; width: 1em; text-align: center; opacity: 0.7; }
	.row .icon { flex: 0 0 auto; opacity: 0.8; }
	.row .name { overflow: hidden; text-overflow: ellipsis; }
	.error-banner { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); padding: 4px 8px; }
`;
document.head.appendChild(style);

const treeEl = document.getElementById('tree')!;

interface TreeNode {
	readonly name: string;
	fullName?: string;
	isCurrent?: boolean;
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
		}
	});
}

function renderNode(node: TreeNode, path: string, depth: number, container: HTMLElement): void {
	const isLeaf = node.fullName !== undefined;

	const row = document.createElement('div');
	row.className = 'row' + (node.isCurrent ? ' current' : '');
	row.style.paddingLeft = `${8 + depth * 14}px`;

	const chevron = document.createElement('span');
	chevron.className = 'chevron';
	chevron.textContent = isLeaf ? '' : collapsedFolders.has(path) ? '▸' : '▾';
	row.appendChild(chevron);

	const icon = document.createElement('span');
	icon.className = 'icon';
	icon.textContent = isLeaf ? (node.isCurrent ? '★' : '⎇') : collapsedFolders.has(path) ? '📁' : '📂';
	row.appendChild(icon);

	const name = document.createElement('span');
	name.className = 'name';
	name.textContent = node.name;
	row.appendChild(name);

	if (isLeaf) {
		row.title = `${node.fullName}\nDouble-click to check out`;
		row.addEventListener('dblclick', () => post({ type: 'checkout', name: node.fullName! }));
	} else {
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

	if (!isLeaf && !collapsedFolders.has(path)) {
		for (const child of node.children.values()) {
			renderNode(child, `${path}/${child.name}`, depth + 1, container);
		}
	}
}

const SECTIONS: { kind: BranchTreeItemDto['kind']; label: string }[] = [
	{ kind: 'local', label: 'Local' },
	{ kind: 'remote', label: 'Remote' },
	{ kind: 'tag', label: 'Tags' },
];

function render(): void {
	treeEl.innerHTML = '';
	for (const section of SECTIONS) {
		const items = branches.filter((b) => b.kind === section.kind);
		if (items.length === 0) {
			continue;
		}

		const label = document.createElement('div');
		label.className = 'section-label';
		label.textContent = section.label;
		treeEl.appendChild(label);

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
			render();
			break;
		case 'error':
			showError(message.message);
			break;
	}
});

post({ type: 'ready' });
