// What an app written against the packed packages does. Two viewers share the page: the first with
// every default, the second asking for keys and keeping, with its controls off (D256, D265, D267).
import { createViewer } from '@j3d/viewer';

const report = { commands: { first: [], second: [] }, picks: [], loaded: [], failed: [] };
window.__packaging = report;

const fixture = async (name) => new File([await (await fetch(`/fixtures/${name}`)).blob()], name);

const first = createViewer(document.getElementById('first'), {
  onCommand: (command) => report.commands.first.push(command),
});
const second = createViewer(document.getElementById('second'), {
  keys: true,
  keep: { name: 'packaging-check' },
  viewCube: false,
  homeButton: false,
  viewButtons: false,
  dropFiles: false,
  onCommand: (command) => report.commands.second.push(command),
  onPick: (part) => {
    report.picks.push(part ?? null);
    if (part) {
      second.setPartState(part.id, [], [part.node]);
    }
  },
});

const untilLoaded = (viewer, names) =>
  new Promise((resolve) => {
    const waiting = new Set(names);
    const done = (name) => {
      waiting.delete(name);
      if (waiting.size === 0) {
        resolve();
      }
    };
    viewer.subscribe({
      loaded: ({ summary }) => {
        report.loaded.push(summary.fileName);
        done(summary.fileName);
      },
      failed: (id, error) => {
        const name = viewer.models().find(({ summary }) => summary.id === id)?.summary.fileName ?? id;
        report.failed.push(`${name}: ${error.code} ${error.message}`);
        done(name);
      },
    });
  });

const firstFiles = ['assembly.step', 'part.stl', 'draco.glb', 'ktx2.glb', 'meshopt.glb'];
const firstLoaded = untilLoaded(first, firstFiles);
first.importFiles(await Promise.all(firstFiles.map(fixture)));
const secondLoaded = untilLoaded(second, ['box.brep']);
second.importFiles([await fixture('box.brep')]);
await Promise.all([firstLoaded, secondLoaded]);

report.scenes = { first: (await first.restoreScene()).status, second: (await second.restoreScene()).status };
report.capabilities = first.capabilities();
report.styles = {
  host: getComputedStyle(document.getElementById('first')).position,
  home: getComputedStyle(document.querySelector('#first .j3d-home-button')).position,
  labels: getComputedStyle(document.querySelector('#first .j3d-measure-labels')).position,
};
report.controls = {
  first: ['.j3d-home-button', '.j3d-previous-view', '.j3d-next-view', '.j3d-drop-overlay'].map((selector) => document.querySelector(`#first ${selector}`) !== null),
  second: ['.j3d-home-button', '.j3d-previous-view', '.j3d-next-view', '.j3d-drop-overlay'].map((selector) => document.querySelector(`#second ${selector}`) !== null),
};
report.ready = true;
