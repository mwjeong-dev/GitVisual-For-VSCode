import { describe, expect, it } from 'vitest';
import { layoutCommits } from '../web/graph/layout';

function commit(hash: string, parents: string[]) {
	return { hash, parents, authorName: 'a', date: '2024-01-01T00:00:00Z', refs: [], subject: hash };
}

describe('layoutCommits', () => {
	it('keeps a linear history in a single lane', () => {
		const { nodes, edges } = layoutCommits([commit('C', ['B']), commit('B', ['A']), commit('A', [])]);
		expect(nodes.map((n) => n.column)).toEqual([0, 0, 0]);
		expect(edges).toEqual([
			{ parentHash: 'B', fromColumn: 0, fromRow: 0, toColumn: 0, toRow: 1 },
			{ parentHash: 'A', fromColumn: 0, fromRow: 1, toColumn: 0, toRow: 2 },
		]);
	});

	it('gives a merge parent its own lane and reconverges at the shared ancestor', () => {
		// M merges P1 and P2, both of which descend from G.
		const { nodes, edges } = layoutCommits([
			commit('M', ['P1', 'P2']),
			commit('P1', ['G']),
			commit('P2', ['G']),
			commit('G', []),
		]);

		const columnByHash = Object.fromEntries(nodes.map((n) => [n.hash, n.column]));
		expect(columnByHash).toEqual({ M: 0, P1: 0, P2: 1, G: 0 });

		expect(edges).toEqual([
			{ parentHash: 'P1', fromColumn: 0, fromRow: 0, toColumn: 0, toRow: 1 },
			{ parentHash: 'P2', fromColumn: 0, fromRow: 0, toColumn: 1, toRow: 2 },
			{ parentHash: 'G', fromColumn: 0, fromRow: 1, toColumn: 0, toRow: 3 },
			{ parentHash: 'G', fromColumn: 1, fromRow: 2, toColumn: 0, toRow: 3 },
		]);
	});

	it('leaves an edge undefined when the parent is outside the loaded window', () => {
		const { edges } = layoutCommits([commit('A', ['MISSING'])]);
		expect(edges).toEqual([{ parentHash: 'MISSING', fromColumn: 0, fromRow: 0, toColumn: 0, toRow: undefined }]);
	});

	it('keeps disconnected branch tips in separate lanes in an all-branches graph', () => {
		const { nodes } = layoutCommits([
			commit('FEATURE', ['FEATURE_ROOT']),
			commit('FEATURE_ROOT', []),
			commit('MAIN', ['MAIN_ROOT']),
			commit('MAIN_ROOT', []),
		]);
		const columnByHash = Object.fromEntries(nodes.map((node) => [node.hash, node.column]));
		expect(columnByHash).toEqual({ FEATURE: 0, FEATURE_ROOT: 0, MAIN: 1, MAIN_ROOT: 1 });
	});
});
