import type { ExtensionToGraphMessage, GraphToExtensionMessage } from '../../src/shared/protocol/graph';
import { layoutCommits } from './layout';
import { COL_WIDTH, laneColor, renderGraphSvg, ROW_HEIGHT } from './render';

const vscode = acquireVsCodeApi();

function post(message: GraphToExtensionMessage): void {
	vscode.postMessage(message);
}

const root = document.getElementById('root')!;
root.innerHTML = `
	<div class="graph-container" id="graph-container">
		<div class="graph-rows" id="graph-rows"></div>
	</div>
`;

const style = document.createElement('style');
style.textContent = `
	html, body { height: 100%; overflow-x: hidden; }
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0; margin: 0; }
	.graph-container { position: relative; height: 100vh; overflow: auto; }
	.graph-container svg { position: absolute; top: 0; left: 0; pointer-events: none; }
	.graph-rows { position: relative; }
	.graph-row { display: flex; align-items: center; gap: 8px; white-space: nowrap; cursor: pointer; padding-right: 8px; }
	.graph-row:hover { background: var(--vscode-list-hoverBackground); }
	.graph-row .hash { opacity: 0.6; font-family: var(--vscode-editor-font-family); font-size: 0.85em; flex: 0 0 auto; }
	.graph-row .subject { overflow: hidden; text-overflow: ellipsis; }
	.graph-row .ref-badge { flex: 0 0 auto; font-size: 0.75em; padding: 0 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
	.graph-row .meta { flex: 0 0 auto; opacity: 0.6; font-size: 0.85em; }
	.error-banner { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); padding: 4px 8px; }
`;
document.head.appendChild(style);

const containerEl = document.getElementById('graph-container')!;
const rowsEl = document.getElementById('graph-rows')!;

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

function render(): void {
	containerEl.querySelector('svg')?.remove();
}

window.addEventListener('message', (event: MessageEvent<ExtensionToGraphMessage>) => {
	const message = event.data;
	switch (message.type) {
		case 'commits': {
			render();
			const layout = layoutCommits(message.commits);
			const svg = renderGraphSvg(layout);
			containerEl.insertBefore(svg, rowsEl);

			rowsEl.style.paddingLeft = `${Math.max(1, layout.laneCount) * COL_WIDTH}px`;
			rowsEl.innerHTML = '';
			for (const node of layout.nodes) {
				const row = document.createElement('div');
				row.className = 'graph-row';
				row.style.height = `${ROW_HEIGHT}px`;

				const hashEl = document.createElement('span');
				hashEl.className = 'hash';
				hashEl.style.color = laneColor(node.column);
				hashEl.textContent = node.hash.slice(0, 7);
				row.appendChild(hashEl);

				for (const ref of node.refs) {
					const badge = document.createElement('span');
					badge.className = 'ref-badge';
					badge.textContent = ref;
					row.appendChild(badge);
				}

				const subjectEl = document.createElement('span');
				subjectEl.className = 'subject';
				subjectEl.textContent = node.subject;
				row.appendChild(subjectEl);

				const metaEl = document.createElement('span');
				metaEl.className = 'meta';
				metaEl.textContent = `${node.authorName} · ${formatDate(node.date)}`;
				row.appendChild(metaEl);

				row.title = `${node.hash}\n${node.subject}\n${node.authorName} · ${node.date}`;
				row.addEventListener('click', () => post({ type: 'openCommit', hash: node.hash }));

				rowsEl.appendChild(row);
			}
			break;
		}
		case 'error':
			showError(message.message);
			break;
	}
});

function showError(message: string): void {
	const banner = document.createElement('div');
	banner.className = 'error-banner';
	banner.textContent = message;
	root.prepend(banner);
	setTimeout(() => banner.remove(), 5000);
}

post({ type: 'ready' });
