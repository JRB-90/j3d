// What each package says of itself (D285, §7): its licence and notices, cut from THIRD-PARTY-NOTICES.md, which
// stays the one list of what ships. It fails if a component or licence named here isn't found there, so the
// root file can't drift from what's asked of it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const Repository = 'https://github.com/JRB-90/j3d';

const Kernel = {
  components: ['Open CASCADE Technology (OCCT)', 'Emscripten', 'musl libc', 'LLVM', 'mimalloc'],
  mit: ['mimalloc'],
  licences: ['musl libc', 'Emscripten', 'LLVM runtime libraries', 'GNU Lesser General Public License 2.1'],
};

const Viewer = {
  components: ['three.js', 'camera-controls', 'Draco', 'Basis Universal', 'meshoptimizer'],
  mit: ['three.js', 'camera-controls', 'meshoptimizer'],
  licences: ['Apache License 2.0'],
};

/** A package's text, by what it ships: the viewer's tarball ships none of the others' code, which install beside it. */
const Packages = {
  occt: {
    intro: '`@j3d/occt` is licensed under the GNU LGPL 2.1 with the Open CASCADE exception: see `LICENSE`. It includes the third-party software below, under the licences reproduced further down.',
    ...Kernel,
    source: true,
  },
  blazor: {
    intro: "`J3D.Blazor`'s own code is licensed under the MIT License: see `LICENSE`. Its bundle, under `staticwebassets/viewer`, includes the third-party software below, under the licences reproduced further down. The OCCT WebAssembly is a separate file there, under the LGPL 2.1 with the Open CASCADE exception, and a project publishing `J3D.Blazor` ships it as a separate, replaceable file too.",
    components: [...Kernel.components, ...Viewer.components],
    mit: [...Viewer.mit, ...Kernel.mit],
    licences: [...Kernel.licences, ...Viewer.licences],
    source: true,
  },
};

const ViewerNotice = `# Third-party notices

\`@j3d/viewer\` is licensed under the MIT License: see \`LICENSE\`. Its tarball holds only its own code. What it runs on installs beside it, each package with its own licence:

- \`@j3d/occt\`, the OCCT kernel, under the GNU LGPL 2.1 with the Open CASCADE exception, as a separate file of the same release.
- \`three\` (MIT), which your project provides, and whose folder holds the Draco (Apache-2.0), Basis Universal (Apache-2.0) and meshoptimizer (MIT) decoders the viewer fetches for compressed glTF.
- \`camera-controls\` (MIT).
`;

function parts() {
  const text = readFileSync(join(import.meta.dirname, '..', 'THIRD-PARTY-NOTICES.md'), 'utf8').replaceAll('\r\n', '\n');
  const between = (from, to) => {
    const start = text.indexOf(from);
    const end = to ? text.indexOf(to, start) : text.length;
    if (start < 0 || end < 0) {
      throw new Error(`THIRD-PARTY-NOTICES.md has no "${start < 0 ? from : to}".`);
    }
    return text.slice(start, end);
  };
  const licenceTexts = between('## Licence texts');
  const sections = licenceTexts.split(/^(?=### )/m).slice(1);
  const section = (name) => {
    const found = sections.find((candidate) => candidate.startsWith(`### ${name}`));
    if (!found) {
      throw new Error(`THIRD-PARTY-NOTICES.md has no licence text for "${name}".`);
    }
    return found;
  };
  const rows = between('## Components', '## OCCT source').split('\n').filter((line) => line.startsWith('| ['));
  // Each MIT text is a label's line and its fenced block.
  const mitBlocks = section('MIT License').split(/^(?=\S.*:\n\n```)/m).slice(1);
  return { rows, section, mitBlocks, source: between('## OCCT source', '## Licence texts') };
}

function pick(items, names, matches, what) {
  return names.map((name) => {
    const found = items.find((item) => matches(item, name));
    if (!found) {
      throw new Error(`THIRD-PARTY-NOTICES.md has no ${what} for "${name}".`);
    }
    return found;
  });
}

/** A package's THIRD-PARTY-NOTICES.md, with the repo's links pinned to the release it comes from. */
export function noticesFor(name, version) {
  if (name === 'viewer') {
    return ViewerNotice;
  }
  const { intro, components, mit, licences, source } = Packages[name];
  const { rows, section, mitBlocks, source: sourceText } = parts();
  // The fourth column says where it ships in the app, which differs here.
  const table = pick(rows, components, (row, component) => row.startsWith(`| [${component}`), 'component').map((row) => `| ${row.split(' | ').slice(0, 3).join(' | ').replace(/^\| /, '')} |`);
  const text = `# Third-party notices

${intro}

*This file is a good-faith record of what ships, not legal advice.*

## Components

| Component | Version | Licence |
|---|---|---|
${table.join('\n')}

${source ? sourceText : ''}## Licence texts

### MIT License

${pick(mitBlocks, mit, (block, label) => block.startsWith(label), 'MIT text').join('')}${licences.map(section).join('')}`;
  return text.replace(/\]\(src\//g, `](${Repository}/blob/v${version}/src/`).replace(/\n+$/, '\n');
}

/** The kernel's `LICENSE`: the exception and the LGPL as OCCT gives them. */
export function kernelLicence() {
  const body = parts().section('GNU Lesser General Public License 2.1').replace(/^### .*\n\n/, '').replace(/^```.*\n/gm, '');
  return `@j3d/occt is licensed under the GNU Lesser General Public License 2.1, with the Open CASCADE exception. Both follow.\n\n${body}`;
}
