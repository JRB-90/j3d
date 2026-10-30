// What the packaging check and the samples' smoke test share: serving files, running a server, and watching a page.

import { execSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

export const here = import.meta.dirname;
export const repo = join(here, '..', '..');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.map': 'application/json' };

export function serve(dir, port) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    const file = join(dir, path === '/' ? 'index.html' : path);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  return new Promise((ready) => server.listen(port, '127.0.0.1', () => ready({ stop: () => server.close() })));
}

export function startProcess(command, cwd = here) {
  const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  return {
    log: () => log,
    stop() {
      if (process.platform === 'win32') {
        try {
          execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
        } catch {
          // already gone
        }
      } else {
        child.kill();
      }
    },
  };
}

export async function waitForServer(url, server) {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    if (await fetch(url).then(({ ok }) => ok, () => false)) {
      return;
    }
    await new Promise((wait) => setTimeout(wait, 500));
  }
  throw new Error(`${url} never answered.\n${server.log?.().slice(-1500) ?? ''}`);
}

/** What goes wrong on a page, gathered as it runs. */
export function watchProblems(page) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console error: ${message.text().slice(0, 300)}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      problems.push(`${response.status()} ${response.url()}`);
    }
  });
  return problems;
}

/** How much of the viewer isn't its first pixel's colour: a canvas that drew nothing is all one colour. */
export const drawnShare = (page, png) =>
  page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let different = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) {
        different++;
      }
    }
    return different / (data.length / 4);
  }, png.toString('base64'));

export const launch = (chromium) =>
  chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
