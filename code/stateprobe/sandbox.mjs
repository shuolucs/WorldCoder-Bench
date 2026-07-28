/**
 * Layer 1: Sandbox — browser lifecycle, static server, CDN interception.
 *
 * Usage:
 *   const sandbox = new Sandbox({ taskDir, htmlFile, headless: true });
 *   const { page, consoleErrors } = await sandbox.launch();
 *   // ... run checks ...
 *   await sandbox.teardown();
 */

import { chromium } from 'playwright';
import { createServer } from 'http';
import { join, resolve, dirname, extname, basename, sep } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

export class Sandbox {
  constructor(opts = {}) {
    this.taskDir = resolve(opts.taskDir || opts.rootDir || '.');
    this.releaseRoot = resolve(opts.releaseRoot || this.taskDir);
    this.htmlFile = opts.htmlFile || (opts.htmlPath ? 'input.html' : 'ground_truth.html');
    this.htmlPath = opts.htmlPath ? resolve(opts.htmlPath) : null;
    this.headless = opts.headless !== false;
    this.timeout = opts.timeout || 30000;
    this.viewport = opts.viewport || { width: 1280, height: 720 };
    this.initWaitMs = opts.initWaitMs || 2000;

    this._server = null;
    this._browser = null;
    this._context = null;
    this.page = null;
    this.consoleErrors = [];
    this.port = 0;
  }

  async launch() {
    const { server, port } = await this._startServer(this.taskDir);
    this._server = server;
    this.port = port;

    const launchOpts = {
      headless: this.headless,
      args: ['--no-sandbox', '--disable-gpu-sandbox'],
    };
    if (this.headless) launchOpts.args.unshift('--headless=new');
    const chrome = this._browserPath();
    if (chrome) launchOpts.executablePath = chrome;

    this._browser = await chromium.launch(launchOpts);
    this._context = await this._browser.newContext({ viewport: this.viewport });
    this.page = await this._context.newPage();

    this.consoleErrors = [];
    this.page.on('console', msg => { if (msg.type() === 'error') this.consoleErrors.push(msg.text()); });
    this.page.on('pageerror', err => this.consoleErrors.push(err.message));

    await this._setupCdnIntercept(this.page);

    const url = `http://127.0.0.1:${port}/${encodeURIComponent(this.htmlFile)}`;
    await this.page.goto(url, { waitUntil: 'networkidle', timeout: this.timeout });
    await this.page.waitForTimeout(this.initWaitMs);

    return { page: this.page, consoleErrors: this.consoleErrors, url };
  }

  async screenshot(path) {
    if (this.page) return this.page.screenshot({ path });
  }

  async teardown() {
    if (this._browser) await this._browser.close().catch(() => {});
    if (this._server) this._server.close();
    this._browser = null;
    this._server = null;
    this.page = null;
  }

  _startServer(rootDir) {
    return new Promise(res => {
      const server = createServer((req, resp) => {
        const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (this.htmlPath && requestPath === `/${this.htmlFile}`) {
          if (!existsSync(this.htmlPath)) { resp.writeHead(404); resp.end('Input HTML not found'); return; }
          resp.writeHead(200, { 'Content-Type': MIME['.html'], 'Access-Control-Allow-Origin': '*' });
          resp.end(readFileSync(this.htmlPath)); return;
        }
        let filePath = join(rootDir, requestPath === '/' ? 'index.html' : requestPath);
        if (requestPath.startsWith('/assets/shared/')) {
          filePath = join(this.releaseRoot, 'data', 'assets', 'shared', requestPath.slice('/assets/shared/'.length));
        } else if (requestPath.startsWith('/shared_assets/')) {
          filePath = join(this.releaseRoot, 'data', 'assets', 'shared', requestPath.slice('/shared_assets/'.length));
        } else if (requestPath.startsWith('/assets/')) {
          filePath = join(this.releaseRoot, 'data', 'assets', 'shared', requestPath.slice('/assets/'.length));
        }
        // Historical prompts sometimes use ./asset.ext. Those binaries are
        // now deduplicated under data/assets/shared, so resolve an exact basename
        // only when the requested path did not resolve directly.
        if (!existsSync(filePath)) {
          const name = basename(requestPath);
          if (name && name !== '.' && name !== '..' && !name.includes('\\')) {
            const fallback = join(this.releaseRoot, 'data', 'assets', 'shared', name);
            if (existsSync(fallback)) filePath = fallback;
          }
        }
        const safeRoot = resolve(this.releaseRoot), safePath = resolve(filePath);
        if (!safePath.startsWith(`${safeRoot}${sep}`) && safePath !== safeRoot) { resp.writeHead(400); resp.end('Invalid path'); return; }
        if (!existsSync(safePath)) { resp.writeHead(404); resp.end('Not Found'); return; }
        filePath = safePath;
        const ext = extname(filePath).toLowerCase();
        resp.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        });
        resp.end(readFileSync(filePath));
      });
      server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
    });
  }

  async _setupCdnIntercept(page) {
    const THREE_LOCAL = resolve(__dirname, '..', 'vendor', 'three');
    if (!existsSync(THREE_LOCAL)) return;

    const serve = async (route, request) => {
      const url = new URL(request.url());
      const subpath = url.pathname.replace(/^\/npm\/three@[^/]+\//, '').replace(/^\/three@[^/]+\//, '');
      const localFile = join(THREE_LOCAL, subpath);
      if (existsSync(localFile)) {
        const body = readFileSync(localFile);
        const ext = subpath.split('.').pop();
        const ct = ext === 'js' || ext === 'mjs' ? 'application/javascript' : 'application/octet-stream';
        await route.fulfill({ status: 200, contentType: ct, body });
      } else {
        await route.continue();
      }
    };

    await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]*\/(.*)/, serve);
    await page.route(/unpkg\.com\/three@[^/]*\/(.*)/, serve);
  }

  _browserPath() {
    const candidates = [process.env.CHROME_PATH, process.env.CHROMIUM_PATH,
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    return candidates.filter(Boolean).find(existsSync) || null;
  }
}
