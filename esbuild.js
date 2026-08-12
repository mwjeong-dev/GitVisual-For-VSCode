const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

function findWebEntries() {
	const webDir = path.join(__dirname, 'web');
	if (!fs.existsSync(webDir)) return [];
	return fs
		.readdirSync(webDir)
		.map((name) => path.join(webDir, name, 'main.ts'))
		.filter((entry) => fs.existsSync(entry));
}

async function main() {
	const extensionCtx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node18',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		sourcemap: !production,
		minify: production,
		logLevel: 'info',
	});

	const webEntries = findWebEntries();
	const webCtx = webEntries.length
		? await esbuild.context({
				entryPoints: webEntries,
				bundle: true,
				format: 'iife',
				platform: 'browser',
				target: 'es2022',
				outdir: 'dist/webviews',
				outbase: 'web',
				sourcemap: !production,
				minify: production,
				logLevel: 'info',
			})
		: null;

	if (watch) {
		console.log('[watch] build started');
		await extensionCtx.watch();
		if (webCtx) await webCtx.watch();
		console.log('[watch] build finished');
	} else {
		await extensionCtx.rebuild();
		if (webCtx) await webCtx.rebuild();
		await extensionCtx.dispose();
		if (webCtx) await webCtx.dispose();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
