import { spawn } from 'child_process';
import * as vscode from 'vscode';

export interface SpawnGitResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

export class GitCommandError extends Error {
	constructor(
		readonly args: readonly string[],
		readonly result: SpawnGitResult,
	) {
		super(`git ${args.join(' ')} exited with code ${result.exitCode}: ${result.stderr.trim()}`);
	}
}

function getGitPath(): string {
	return vscode.workspace.getConfiguration('git').get<string>('path') || 'git';
}

/**
 * Every direct `git` invocation in this extension goes through here — features
 * that need plumbing the public vscode.git API doesn't expose (hunk-level
 * index writes, --all/--topo-order graph data, `log -L`) call this instead of
 * spawning `child_process` themselves.
 */
export function spawnGit(
	cwd: string,
	args: readonly string[],
	options?: { input?: string; env?: NodeJS.ProcessEnv },
): Promise<SpawnGitResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(getGitPath(), args, {
			cwd,
			env: { ...process.env, ...options?.env, GIT_OPTIONAL_LOCKS: '0' },
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

		child.on('error', reject);
		child.on('close', (exitCode) => {
			const result: SpawnGitResult = {
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
				exitCode: exitCode ?? -1,
			};
			if (result.exitCode !== 0) {
				reject(new GitCommandError(args, result));
				return;
			}
			resolve(result);
		});

		if (options?.input !== undefined) {
			child.stdin.write(options.input, 'utf8');
		}
		child.stdin.end();
	});
}
