import { createTranslator } from '../../src/shared/localization';
import type { ExtensionToPushPreviewMessage, PushCommitDto, PushFileDto, PushPreviewDto, PushPreviewToExtensionMessage } from '../../src/shared/protocol/pushPreview';

const vscode = acquireVsCodeApi();
const text = createTranslator(navigator.language);
const post = (message: PushPreviewToExtensionMessage): void => vscode.postMessage(message);
let preview: PushPreviewDto | undefined;
let selectedHash: string | undefined;
let files: PushFileDto[] = [];
let busy = false;

const root = document.getElementById('root')!;
root.innerHTML = `
<main>
  <header><div><h2>${text('Push commits', '커밋 푸시')}</h2><div id="target" class="target"></div></div><button id="close" class="icon-button" title="${text('Cancel', '취소')}">×</button></header>
  <section class="content">
    <div class="commits-pane"><div class="pane-title">${text('Commits to push', '푸시할 커밋')}</div><div id="commits" class="commits"></div></div>
    <div class="files-pane"><div class="pane-title"><span>${text('Changed files', '변경된 파일')}</span><span id="file-count" class="muted"></span></div><div id="files" class="files"></div></div>
  </section>
  <div id="error" class="error hidden"></div>
  <footer>
    <label><input id="tags" type="checkbox"> ${text('Push all tags', '모든 태그 푸시')}</label>
    <div class="actions"><select id="mode"><option value="normal">${text('Push', '푸시')}</option><option value="force">${text('Force Push', '포스 푸시')}</option></select><button id="push" class="primary">${text('Push', '푸시')}</button><button id="cancel">${text('Cancel', '취소')}</button></div>
  </footer>
</main>`;

const style = document.createElement('style');
style.textContent = `
*{box-sizing:border-box}html,body,#root{height:100%;margin:0}body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
main{height:100%;min-height:420px;display:flex;flex-direction:column;border:1px solid var(--vscode-panel-border)}
header{height:66px;display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-bottom:1px solid var(--vscode-panel-border)}h2{font-size:15px;margin:0 0 7px}.target{color:var(--vscode-descriptionForeground);font-size:13px}.target b{color:var(--vscode-textLink-foreground);font-weight:500}.icon-button{font-size:24px;background:transparent;color:var(--vscode-icon-foreground);border:0;cursor:pointer}
.content{display:grid;grid-template-columns:minmax(280px,42%) 1fr;flex:1;min-height:0}.commits-pane,.files-pane{display:flex;flex-direction:column;min-width:0}.commits-pane{border-right:1px solid var(--vscode-panel-border)}.pane-title{height:36px;padding:9px 14px;font-size:12px;font-weight:600;border-bottom:1px solid var(--vscode-panel-border);display:flex;justify-content:space-between}.commits,.files{overflow:auto;flex:1}
.commit{padding:9px 14px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 55%,transparent);cursor:pointer}.commit:hover,.file:hover{background:var(--vscode-list-hoverBackground)}.commit.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.subject{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{font-size:11px;margin-top:5px;color:var(--vscode-descriptionForeground);display:flex;gap:10px}.commit.selected .meta{color:inherit;opacity:.72}.hash{font-family:var(--vscode-editor-font-family);color:var(--vscode-textLink-foreground)}
.tree{padding:6px 0}.folder,.file{min-height:27px;display:flex;align-items:center;gap:6px;padding-right:12px;font-size:13px}.folder{color:var(--vscode-descriptionForeground);cursor:pointer}.folder:hover{background:var(--vscode-list-hoverBackground)}.folder-icon{font-size:14px;width:12px}.folder-children.collapsed{display:none}.file{cursor:pointer}.file-name{color:var(--vscode-textLink-foreground)}.status{width:20px;text-align:center;font-size:11px;color:var(--vscode-descriptionForeground)}.muted,.empty{color:var(--vscode-descriptionForeground)}.empty{padding:20px;text-align:center}
footer{min-height:64px;padding:12px 18px;border-top:1px solid var(--vscode-panel-border);display:flex;align-items:center;justify-content:space-between;gap:16px}.actions{display:flex;gap:8px}button,select{font:inherit;border:1px solid var(--vscode-button-border,transparent);padding:6px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}button{cursor:pointer}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);min-width:95px}button:disabled,select:disabled{opacity:.5;cursor:default}.error{padding:7px 14px;background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-inputValidation-errorForeground)}.hidden{display:none}@media(max-width:720px){.content{grid-template-columns:1fr;grid-template-rows:45% 55%}.commits-pane{border-right:0;border-bottom:1px solid var(--vscode-panel-border)}footer{align-items:flex-start;flex-direction:column}.actions{width:100%}.actions select{flex:1}}
`;
document.head.appendChild(style);

const commitsEl = document.getElementById('commits')!;
const filesEl = document.getElementById('files')!;
const targetEl = document.getElementById('target')!;
const fileCountEl = document.getElementById('file-count')!;
const modeEl = document.getElementById('mode') as HTMLSelectElement;
const tagsEl = document.getElementById('tags') as HTMLInputElement;
const pushEl = document.getElementById('push') as HTMLButtonElement;
const errorEl = document.getElementById('error')!;

function render(): void {
	if (!preview) return;
	targetEl.innerHTML = `<b>${escapeHtml(preview.branch)}</b> &nbsp;→&nbsp; <b>${escapeHtml(preview.remote)}/${escapeHtml(preview.remoteBranch)}</b>${preview.hasUpstream ? '' : ` &nbsp;·&nbsp; ${text('set upstream', 'upstream 설정')}`}`;
	commitsEl.innerHTML = '';
	if (preview.commits.length === 0) commitsEl.innerHTML = `<div class="empty">${text('No commits to push', '푸시할 커밋이 없습니다')}</div>`;
	for (const commit of preview.commits) commitsEl.appendChild(renderCommit(commit));
	renderFiles();
	updateControls();
}

function renderCommit(commit: PushCommitDto): HTMLElement {
	const row = document.createElement('div');
	row.className = `commit${commit.hash === selectedHash ? ' selected' : ''}`;
	row.innerHTML = `<div class="subject">${escapeHtml(commit.subject || text('(no subject)', '(제목 없음)'))}</div><div class="meta"><span class="hash">${escapeHtml(commit.shortHash)}</span><span>${escapeHtml(commit.author)}</span><span>${new Date(commit.date).toLocaleString()}</span></div>`;
	row.addEventListener('click', () => { selectedHash = commit.hash; files = []; render(); post({ type: 'selectCommit', hash: commit.hash }); });
	return row;
}

interface TreeNode { folders: Map<string, TreeNode>; files: PushFileDto[]; }
function renderFiles(): void {
	filesEl.innerHTML = '';
	fileCountEl.textContent = files.length > 0 ? `${files.length} ${text(files.length === 1 ? 'file' : 'files', '개 파일')}` : '';
	if (!selectedHash) { filesEl.innerHTML = `<div class="empty">${text('Select a commit to see its files', '파일을 보려면 커밋을 선택하세요')}</div>`; return; }
	if (files.length === 0) { filesEl.innerHTML = `<div class="empty">${text('Loading…', '불러오는 중…')}</div>`; return; }
	const tree: TreeNode = { folders: new Map(), files: [] };
	for (const file of files) {
		const parts = file.path.split('/'); let node = tree;
		for (const folder of parts.slice(0, -1)) { if (!node.folders.has(folder)) node.folders.set(folder, { folders: new Map(), files: [] }); node = node.folders.get(folder)!; }
		node.files.push({ ...file, path: parts.at(-1)! });
	}
	const wrapper = document.createElement('div'); wrapper.className = 'tree'; renderNode(wrapper, tree, 0, ''); filesEl.appendChild(wrapper);
}

function renderNode(parent: HTMLElement, node: TreeNode, depth: number, prefix: string): void {
	for (const [name, child] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
		const row = document.createElement('div'); row.className = 'folder'; row.style.paddingLeft = `${12 + depth * 18}px`; row.innerHTML = `<span class="folder-icon">⌄</span><span>▱</span><span>${escapeHtml(name)}</span>`; parent.appendChild(row);
		const children = document.createElement('div'); children.className = 'folder-children'; parent.appendChild(children);
		row.addEventListener('click', () => { children.classList.toggle('collapsed'); row.querySelector('.folder-icon')!.textContent = children.classList.contains('collapsed') ? '›' : '⌄'; });
		renderNode(children, child, depth + 1, `${prefix}${name}/`);
	}
	for (const file of node.files.sort((a, b) => a.path.localeCompare(b.path))) {
		const fullPath = `${prefix}${file.path}`; const row = document.createElement('div'); row.className = 'file'; row.style.paddingLeft = `${14 + depth * 18}px`;
		row.innerHTML = `<span class="status">${escapeHtml(file.status.charAt(0))}</span><span class="file-name">${escapeHtml(file.path)}</span>`;
		row.addEventListener('click', () => post({ type: 'openFile', hash: selectedHash!, path: fullPath })); parent.appendChild(row);
	}
}

function updateControls(): void {
	const canPush = Boolean(preview && (preview.commits.length > 0 || tagsEl.checked));
	pushEl.disabled = busy || !canPush; modeEl.disabled = busy; tagsEl.disabled = busy;
	pushEl.textContent = busy ? text('Pushing…', '푸시 중…') : modeEl.value === 'force' ? text('Force Push', '포스 푸시') : text('Push', '푸시');
}

modeEl.addEventListener('change', updateControls); tagsEl.addEventListener('change', updateControls);
pushEl.addEventListener('click', () => post({ type: 'push', force: modeEl.value === 'force', pushTags: tagsEl.checked }));
document.getElementById('cancel')!.addEventListener('click', () => post({ type: 'cancel' })); document.getElementById('close')!.addEventListener('click', () => post({ type: 'cancel' }));

window.addEventListener('message', (event: MessageEvent<ExtensionToPushPreviewMessage>) => {
	const message = event.data;
	if (message.type === 'preview') { preview = message.preview; modeEl.value = 'normal'; selectedHash = preview.commits.at(-1)?.hash; files = []; render(); if (selectedHash) post({ type: 'selectCommit', hash: selectedHash }); }
	else if (message.type === 'files' && message.hash === selectedHash) { files = message.files; renderFiles(); }
	else if (message.type === 'busy') { busy = message.busy; updateControls(); }
	else if (message.type === 'error') { errorEl.textContent = message.message; errorEl.classList.remove('hidden'); }
});

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
post({ type: 'ready' });
