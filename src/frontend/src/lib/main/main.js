import { spawnPane, getPanes } from '../views/panes/panes.js';
import { params } from '../views/graph/layout-options/klay.js';
import { spawnGraph } from '../views/graph/node-link.js';
import { PROJECT } from '../utils/controls.js';
import { CONSTANTS } from '../utils/names.js';

let BACKEND = import.meta.env.VITE_BACKEND_RESTFUL;

const info = {
  details: {},
  observer: new ResizeObserver((ms) => {
    const panes = getPanes(); // TODO: move panes to be part of this object?
    ms.forEach(m => {
      panes[m.target.pane]?.cy?.fit(undefined, 30);
      panes[m.target.pane]?.cy?.pcp.redraw();
    });
  }),
}; // singleton

function getDefaultBadge(name) {
  return `<i class="fa-xs ${
    CONSTANTS.INTERACTIONS[name].icon
  }" title="${
    CONSTANTS.INTERACTIONS[name].type
  }"></i>`;
}

function setInfo(newInfo) {
  Object.keys(newInfo).forEach(k => {
    info[k] = newInfo[k];
  });
  info.details = {};
  info.types = {};
  ['s', 't'].forEach(type => {
    Object.keys(info[type]).forEach(k => {
      info.details[k] = info[type][k];
      const t = info.types[k];
      info.types[k] = t ? t + '+' + type : type;
    });
    delete info[type];
  });

  info.badges = {
    ap_init: getDefaultBadge('ap_init'),
    ap_deadlock: getDefaultBadge('ap_deadlock'),
    ap_end: getDefaultBadge('ap_end'),
  };

  Object.keys(info.badges).forEach(ap => {
    const userSelected = info.details[CONSTANTS.atomicPropositions][CONSTANTS[ap]];
    if (userSelected) {
      if (userSelected.icon) {
        info.badges[ap] = `<i class="fa-xs ${userSelected.identifier}" title="${CONSTANTS.INTERACTIONS[ap].type}"></i>`;
      } else {
        info.badges[ap] = `<p title="${CONSTANTS.INTERACTIONS[ap].type}">${userSelected.identifier}</p>`;
      }
    }
  });

  Object.values(getPanes()).forEach(pane => {
    pane.cy.vars['update'].fn(pane.cy);
  });
}

const ww = window.innerWidth;
const numberOfPanes = document.getElementById('numberOfPanes');
if (ww && numberOfPanes) {
  numberOfPanes.value = Math.floor(ww / 200);
}

if (import.meta.env.VITE_HIDE_TODOS !== 'true') {
  document.querySelectorAll('.to-do').forEach(el => el.classList.remove('to-do'));
}

Promise.all([
  fetch(`${BACKEND}/${PROJECT}/status`).then(r => r.json()), fetch(`${BACKEND}/${PROJECT}/initial`).then(r => r.json()),
  // fetch(BACKEND + PROJECT).then((res) => res.json()), // requests entire dataset
]).then((promises) => {
  const newInfo = promises[0].info;
  setInfo(newInfo);
  const data = promises[1];
  const nodesIds = data.nodes
    .map((node) => node.id)
    .filter((id) => !id.startsWith('t'));

  info.initial = `#${nodesIds.join(', #')}`;

  if (document.getElementById('project-id')) {
    document.getElementById('project-id').innerHTML = info.id;
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

export { info, setInfo, BACKEND };
