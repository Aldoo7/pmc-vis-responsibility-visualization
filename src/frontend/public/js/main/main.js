import { spawnPane, getPanes } from '../views/panes/panes.js';
import { params } from '../views/node-link/layout-options/elk.js';
import { spawnGraph } from '../views/node-link/node-link.js';
import { BACKEND, PROJECT } from '../utils/controls.js';
import events from '../utils/events.js';

const info = {}; // singleton

function setInfo(newInfo) {
  Object.keys(newInfo).forEach(k => {
    info[k] = newInfo[k];
  });

  info.metadata ||= {};

  info.metadata.ID = info.ID;
  info.metadata.Scheduler = info.Scheduler;

  delete info.ID;
  delete info.Scheduler;
}

window.onresize = () => {
  dispatchEvent(events.RESIZE_ALL);
};

const ww = window.innerWidth;
if (ww) {
  document.getElementById('numberOfPanes').value = Math.floor(ww / 200);
}

Promise.all([
  fetch(BACKEND + PROJECT + '/status').then(r => r.json()), fetch(BACKEND + PROJECT + '/initial').then(r => r.json()),
  // fetch(BACKEND + PROJECT).then((res) => res.json()) // requests entire dataset
]).then((promises) => {
  const newInfo = promises[0].info;
  setInfo(newInfo);

  const data = promises[1];
  const nodesIds = data.nodes
    .map((node) => node.id)
    .filter((id) => !id.includes('t_'));

  info.metadata.initial = `#${nodesIds.join(', #')}`;

  if (document.getElementById('project-id')) {
    document.getElementById('project-id').innerHTML = info.metadata.ID;
  }

  const firstPaneId = 'pane-0';
  const pane = spawnPane(
    { id: firstPaneId },
    nodesIds,
  );

  spawnGraph(pane, data, params);
});

addEventListener('linked-selection', e => {
  const selection = e.detail.selection;
  const panes = getPanes();
  panes[e.detail.pane].cy.nodes().unselect();
  const strSelection = '#' + selection.map(n => n.id).join(', #');

  if (strSelection !== '#') {
    panes[e.detail.pane].cy.$(strSelection).select();
  }
}, true);

export { info, setInfo };
