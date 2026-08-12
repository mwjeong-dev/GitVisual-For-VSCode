import type { GraphLayout } from './layout';

export const ROW_HEIGHT = 20;
export const COL_WIDTH = 14;
const NODE_RADIUS = 3.5;

const LANE_COLORS = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#be5046'];

export function laneColor(column: number): string {
	return LANE_COLORS[column % LANE_COLORS.length];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function cx(column: number): number {
	return column * COL_WIDTH + COL_WIDTH / 2;
}

function cy(row: number): number {
	return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function renderGraphSvg(layout: GraphLayout): SVGSVGElement {
	const width = Math.max(1, layout.laneCount) * COL_WIDTH;
	const height = layout.nodes.length * ROW_HEIGHT;

	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('width', String(width));
	svg.setAttribute('height', String(height));

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
		path.setAttribute('stroke', laneColor(Math.min(edge.fromColumn, edge.toColumn)));
		path.setAttribute('stroke-width', '1.5');
		path.setAttribute('fill', 'none');
		svg.appendChild(path);
	}

	for (const node of layout.nodes) {
		const circle = document.createElementNS(SVG_NS, 'circle');
		circle.setAttribute('cx', String(cx(node.column)));
		circle.setAttribute('cy', String(cy(node.row)));
		circle.setAttribute('r', String(NODE_RADIUS));
		circle.setAttribute('fill', laneColor(node.column));
		svg.appendChild(circle);
	}

	return svg;
}
