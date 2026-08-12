import type { GraphLayout } from './layout';

export const ROW_HEIGHT = 30;
export const COL_WIDTH = 14;
const NODE_RADIUS = 3.5;

const LANE_COLORS = ['#56b6c2', '#c678dd', '#d6a84b', '#61afef', '#98c379', '#e06c75', '#d19a66', '#7f8cff'];

export function laneColor(column: number, colorOffset = 0): string {
	return LANE_COLORS[(column + colorOffset) % LANE_COLORS.length];
}

/** Stable palette slot so the same branch keeps its color across refreshes. */
export function branchColorOffset(ref: string | undefined): number {
	if (!ref) return 0;
	let hash = 0;
	for (const char of ref) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
	return Math.abs(hash) % LANE_COLORS.length;
}

function branchRefAtNode(refs: readonly string[]): string | undefined {
	const expanded = refs.map((ref) => ref.startsWith('HEAD -> ') ? ref.slice('HEAD -> '.length) : ref);
	const branches = expanded.filter((ref) => !ref.startsWith('tag: ') && ref !== 'HEAD' && !ref.endsWith('/HEAD'));
	// Prefer a local branch decoration over origin/foo when both decorate the
	// same commit. This is where PyCharm visually changes from a feature color
	// to the base branch color (for example feature -> master).
	return branches.find((ref) => !ref.startsWith('origin/')) ?? branches[0];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function cx(column: number): number {
	return column * COL_WIDTH + COL_WIDTH / 2;
}

function cy(row: number): number {
	return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function renderGraphSvg(layout: GraphLayout, colorOffset = 0): SVGSVGElement {
	const width = Math.max(1, layout.laneCount) * COL_WIDTH;
	const height = layout.nodes.length * ROW_HEIGHT;

	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('width', String(width));
	svg.setAttribute('height', String(height));

	const colorOffsetByRow = new Map<number, number>();
	const activeOffsetByColumn = new Map<number, number>();
	for (const node of layout.nodes) {
		const ref = branchRefAtNode(node.refs);
		if (ref) activeOffsetByColumn.set(node.column, branchColorOffset(ref));
		const offset = activeOffsetByColumn.get(node.column) ?? colorOffset;
		colorOffsetByRow.set(node.row, offset);
	}

	for (const edge of layout.edges) {
		if (edge.toRow === undefined) {
			continue;
		}
		const x1 = cx(edge.fromColumn);
		const y1 = cy(edge.fromRow);
		const x2 = cx(edge.toColumn);
		const y2 = cy(edge.toRow);

		const path = document.createElementNS(SVG_NS, 'path');
		const d =
			x1 === x2 ? `M ${x1} ${y1} L ${x2} ${y2}` : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
		path.setAttribute('d', d);
		path.setAttribute('stroke', laneColor(edge.fromColumn, colorOffsetByRow.get(edge.fromRow) ?? colorOffset));
		path.setAttribute('stroke-width', '1.5');
		path.setAttribute('fill', 'none');
		svg.appendChild(path);
	}

	for (const node of layout.nodes) {
		const circle = document.createElementNS(SVG_NS, 'circle');
		circle.setAttribute('cx', String(cx(node.column)));
		circle.setAttribute('cy', String(cy(node.row)));
		circle.setAttribute('r', String(NODE_RADIUS));
		const color = laneColor(node.column, colorOffsetByRow.get(node.row) ?? colorOffset);
		if (node.refs.length > 0) {
			circle.setAttribute('fill', 'var(--vscode-editor-background)');
			circle.setAttribute('stroke', color);
			circle.setAttribute('stroke-width', '2.5');
			circle.setAttribute('r', String(NODE_RADIUS + 1.5));
		} else {
			circle.setAttribute('fill', color);
		}
		svg.appendChild(circle);
	}

	return svg;
}
