// Exercise the actual renderer with 61 cards + 60 connections, without a library.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
    (async () => {
        const output = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-resize-proof-'));
        await require('esbuild').build({
            entryPoints: [path.join(project, 'tests/fixtures/cardResize.jsx')], outfile: path.join(output, 'fixture.js'), bundle: true,
            platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
            plugins: [{ name: 'measure-geometry-work', setup(build) {
                        build.onLoad({ filter: /smartCardGeometry\.js$/ }, async (args) => ({
                            contents: fs.readFileSync(args.path, 'utf8').replace('export function estimateSmartCardGeometry(card = {}) {', 'export function estimateSmartCardGeometry(card = {}) { window.resizeMetrics.estimates++;'), loader: 'js',
                        }));
                    } }],
        });
        const css = await require('postcss')([require('tailwindcss')({ content: [path.join(project, 'src/**/*.{js,jsx}'), path.join(project, 'tests/fixtures/cardResize.jsx')] })])
            .process('@tailwind base;@tailwind utilities;', { from: undefined });
        fs.writeFileSync(path.join(output, 'fixture.css'), css.css);
        fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = require('node:child_process').spawnSync(require('electron'), [__filename, output, ...process.argv.slice(2)], { env, encoding: 'utf8', timeout: 60000 });
        process.stdout.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        if (result.error)
            console.error(result.error);
        process.exitCode = result.status === 0 ? 0 : 1;
    })().catch(error => { console.error(error); process.exitCode = 1; });
}
else {
    const { app, BrowserWindow } = require('electron');
    const output = process.argv[2];
    app.setPath('userData', path.join(output, 'user-data'));
    app.whenReady().then(async () => {
        const win = new BrowserWindow({ width: 1250, height: 850, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        const js = s => win.webContents.executeJavaScript(s);
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        const frames = () => js('resizeProof.frames()');
        try {
            await win.loadFile(path.join(output, 'index.html'));
            for (let i = 0; i < 100 && !await js('window.resizeProof?.ready()'); i++)
                await pause(30);
            assert.ok(await js('resizeProof.ready()'));
            await pause(200);
            const before = await js('resizeProof.rects()');
            const x = before.grip.x + 10, y = before.grip.y + 10;
            await js(`resizeProof.reset();resizeProof.event('mousedown',${x},${y})`);
            let maxLag = 0;
            for (let i = 1; i <= 12; i++) {
                await js(`resizeProof.event('mousemove',${x + i * 20},${y + i * 8})`);
                await frames();
                const state = await js('resizeProof.rects()');
                maxLag = Math.max(maxLag, Math.abs(state.root.width - state.shape.width), Math.abs(state.root.height - state.shape.height));
            }
            await js(`resizeProof.event('mouseup',${x + 240},${y + 96})`);
            await frames();
            const result = await js('resizeProof.rects()');
            console.log(JSON.stringify({ maxLag, metrics: result.metrics, finalWidth: result.card.width, finalHeight: result.card.height }));
            if (process.argv.includes('--expect-bug')) {
                assert.ok(maxLag > 10, 'Reproduce the resize lag first');
                win.destroy();
                app.exit(0);
                return;
            }
            assert.ok(maxLag < 1, 'The drawn card must not lag behind its layout/handle: ' + maxLag);
            assert.equal(result.card.width, 500);
            assert.equal(result.card.height, 246);
            assert.ok(result.metrics.estimates < 60, 'Do not rebuild unchanged card outlines every frame');
            assert.equal(result.metrics.measurements, 0, 'Manual resize needs no smart-title measurement feedback');
            console.log('PASS live resize stays aligned without rebuilding the other 60 smart outlines');
            await js('resizeProof.setZoom(1.3)');
            await pause(200);
            const scaled = await js('resizeProof.rects()');
            const sx = scaled.grip.x + scaled.grip.width / 2, sy = scaled.grip.y + scaled.grip.height / 2;
            await js(`resizeProof.reset();resizeProof.event('mousedown',${sx},${sy});for(let i=1;i<=100;i++)resizeProof.event('mousemove',${sx}+i,${sy}+i);resizeProof.event('mouseup',${sx + 130},${sy + 65})`);
            await frames();
            const rapid = await js('resizeProof.rects()');
            assert.equal(rapid.card.width, 600);
            assert.equal(rapid.card.height, 296);
            assert.ok(rapid.metrics.updates <= 1, 'Burst should flush only the final pointer position');
            console.log('PASS rapid events coalesce, mouseup flushes the exact final size, and zoom scales the delta correctly');
            await js('resizeProof.setSmart()');
            await pause(200);
            const smart = await js('resizeProof.rects()');
            const gx = smart.grip.x + smart.grip.width / 2, gy = smart.grip.y + smart.grip.height / 2;
            await js(`resizeProof.event('mousedown',${gx},${gy});resizeProof.event('mousemove',${gx + 104},${gy + 52})`);
            await frames();
            const stepped = await js('resizeProof.rects()');
            assert.equal(stepped.card.layout_mode, 'manual');
            assert.ok(Math.abs(stepped.grip.x + stepped.grip.width / 2 - gx - 104) < 2, 'Do not jump from the last step to the widest title line');
            assert.ok(Math.abs(stepped.grip.y + stepped.grip.height / 2 - gy - 52) < 2);
            assert.ok(Math.abs(stepped.shape.width - stepped.root.width) < 1);
            await js(`resizeProof.event('mouseup',${gx + 104},${gy + 52})`);
            await frames();
            assert.equal(stepped.card.description, before.card.description);
            console.log('PASS resizing from a narrow smart step keeps the handle under the pointer and preserves saved content');
            fs.writeFileSync(path.join(output, 'resize.png'), (await win.webContents.capturePage()).toPNG());
            console.log('SCREENSHOT: ' + path.join(output, 'resize.png'));
            win.destroy();
            app.exit(0);
        }
        catch (error) {
            console.error(error);
            win.destroy();
            app.exit(1);
        }
    });
}
