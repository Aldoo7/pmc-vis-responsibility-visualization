import { info } from '../../main/main.js';
import {
  colors,
  stylesheet,
} from '../../../style/views/cy-style.js';
import {
  getPanes,
  spawnPane,
  togglePane,
  destroyPanes,
  updatePanes,
  expandPane,
  collapsePane,
  highlightPaneById,
} from '../panes/panes.js';
import { handleEditorSelection } from '../editor.js';
import {
  h,
  t,
  fixed,
} from '../../utils/utils.js';
import {
  makeTippy,
  hideAllTippies,
  setPane,
  PROJECT,
  BACKEND,
} from '../../utils/controls.js';
import { parallelCoords } from '../parallel-coords/parallel-coords.js';
import { ndl_to_pcp } from '../format.js';
import { CONSTANTS } from '../../utils/names.js';
import events from '../../utils/events.js';

const THROTTLE_DEBOUNCE_DELAY = 100;
var iteration = 0;
var maxIteration = 5;

const setMaxIteration = (value) => {
  maxIteration = value;
};

const socket = io();
let selectedPanesData = {
  selectedPanes: [],
  paneCy: null,
};

function getEdgeId(edge) {
  return edge.data.source + edge.data.label + edge.data.target;
}

// used to avoid duplication and wrong removal of nodes and edges
function setElementMapper(cy, elements) {
  cy.elementMapper = {
    nodes: new Map(),
    edges: new Map(),
  };
  elements.nodes.forEach((node) => {
    node.data.id;
    cy.elementMapper.nodes.set(node.data.id, node);
  });
  elements.edges.forEach((edge) => {
    cy.elementMapper.edges.set(getEdgeId(edge), edge);
  });
}

// applies data dependent styling to nodes
function setStyles(cy) {
  cy.startBatch();
  cy.nodes()
    .addClass('t')
    .filter(n => n.data().type === 's')
    .removeClass('t')
    .addClass('s');

  cy.edges()
    .removeClass('scheduler')
    .filter((n) => {
      const source = n.data().source;
      const target = n.data().target;
      if (source && source.startsWith('t_')) {
        const node = cy.elementMapper.nodes.get(source);
        if (node && node.data.scheduler) {
          const nodeSchedulerValue = node.data.scheduler[cy.vars['scheduler'].value];
          return nodeSchedulerValue > 0;
        }

        return false;
      }

      if (target && target.startsWith('t_')) {
        const node = cy.elementMapper.nodes.get(target);
        if (node && node.data.scheduler) {
          const nodeSchedulerValue = node.data.scheduler[cy.vars['scheduler'].value];
          return nodeSchedulerValue > 0;
        }

        return false;
      }
    })
    .addClass('scheduler');

  cy.endBatch();
}

// queries and updates info on present graph
async function renewInfo(cy) {
  async function getSameGraph(nodes) {
    const ids = nodes.open.join('&id=');
    const idus = nodes.closed.join('&idu=');

    const call = `${BACKEND}${PROJECT}/reset?${
      ids.length > 0 ? '&id=' + ids : ''}${
      idus.length > 0 ? '&idu=' + idus : ''}`;

    return await (await fetch(call)).json();
  }

  const graph = {
    open: cy.$('node.s[[outdegree > 0]]').map(n => n.data().id),
    closed: cy.$('node.s[[outdegree = 0]]').map(n => n.data().id),
  };
  const data = await getSameGraph(graph);
  const mapper = {};

  data.nodes.forEach(n => {
    mapper[n.id] = n;
  });

  cy.nodes().forEach(n => {
    const id = n.data().id;
    cy.elementMapper.nodes.set(id, n);
    if (mapper[id]) n.data('details', mapper[id].details);
  });
}

// requests outgoing edges from a selection of nodes and adds them to the graph
async function expandGraph(cy, nodes, onLayoutStopFn) {
  if (!nodes.length) return;

  const res = await fetch(
    BACKEND
      + PROJECT
      + '/outgoing?id='
      + nodes.map(n => n.data().id).join('&id='),
  );
  const data = await res.json();
  const elements = {
    nodes: data.nodes
      .map(d => ({
        group: 'nodes',
        data: d,
        // position: node.position()
        // WARNING: setting this prop makes nodes immutable, possible bug with cytoscape
      }))
      .filter(d => {
        const accept = !cy.elementMapper.nodes.has(d.data.id);
        if (accept) {
          cy.elementMapper.nodes.set(d.data.id, d);
        }
        return accept;
      }),
    edges: data.edges
      .map(d => ({
        group: 'edges',
        data: {
          id: d.id,
          label: d.label,
          source: d.source,
          target: d.target,
        },
      }))
      .filter(d => {
        const accept = !cy.elementMapper.edges.has(getEdgeId(d));
        if (accept) {
          cy.elementMapper.edges.set(getEdgeId(d), d);
        }
        return accept;
      }),
  };

  cy.nodes().lock();
  cy.add(elements);
  if (elements.nodes.length > 0) {
    cy.$('#' + elements.nodes.map((n) => n.data.id).join(', #')).position(
      nodes[0].position(),
    ); // alternatively, cy.nodes().position(node.position())
  }
  cy.nodes().unlock();

  const layout = cy.layout(cy.params);
  layout.pon('layoutstop').then(onLayoutStopFn);
  layout.run();
  bindListeners(cy);
  setStyles(cy);
  initHTML(cy);

  const nodesIds = data.nodes
    .map((node) => node.id)
    .filter((id) => !id.includes('t_'));

  const panes = getPanes();
  panes[cy.paneId].nodesIds = new Set([...(panes[cy.paneId].nodesIds || []), ...nodesIds]);
  updatePanes(panes);
}

function initHTML(cy) {
  const html = document.getElementById(cy.container().id);

  Array.from(html.childNodes[0].childNodes).forEach((d, i) => {
    // the html layer lives here, remove it before creating a new one
    i > 2 && d.remove();
  });

  window.selectAP = (ap) => {
    const events = {};
    events[CONSTANTS.ap_init] = () => document
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, keyCode: 73 }),
      );
    events[CONSTANTS.ap_deadlock] = () => document
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, keyCode: 68 }),
      );
    events[CONSTANTS.ap_end] = () => document
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, keyCode: 69 }),
      );
    events[ap]();
  };

  function apsfn(data, padding) {
    const aps = data.details[CONSTANTS.atomicPropositions];

    if (!(aps[CONSTANTS.ap_init] || aps[CONSTANTS.ap_deadlock] || aps[CONSTANTS.ap_end])) {
      return;
    }

    return `<div style="position: relative; padding-top:${padding}px" id="${cy.htmlID}">
      ${aps[CONSTANTS.ap_init]
        ? `<a onclick="selectAP('${CONSTANTS.ap_init}')" title="Select all initial states">
          <i class="fa-xs fa-regular fa-circle-play"></i>
        </a>` : ''}
      ${aps[CONSTANTS.ap_deadlock]
        ? `<a onclick="selectAP('${CONSTANTS.ap_deadlock}')" title="Select all deadlocks">
          <i class="fa-xs fa-solid fa-rotate-left"></i>
        </a>` : ''}
      ${aps[CONSTANTS.ap_end]
        ? `<a onclick="selectAP('${CONSTANTS.ap_end}')" title="Select all end states">
        <i class="fa-xs fa-solid fa-flag-checkered"></i>
        </a>` : ''}
    </div>`;
  }

  cy.nodeHtmlLabel([
    {
      query: '.s',
      tpl(data) {
        return apsfn(data, 36.5);
      },
    },
    {
      query: '.s:selected',
      tpl(data) {
        return apsfn(data, 45);
      },
    },
  ], { enablePointerEvents: true });
}

// inits cy with graph data on a pane
function spawnGraph(pane, data, params, vars = {}) {
  const elements = {
    nodes: data.nodes.map(d => ({ data: d.data ? d.data : d })),
    edges: data.edges.map(d => ({ data: d.data ? d.data : d })),
  };

  const cytoscapeInit = {
    container: document.getElementById(pane.container),
    style: stylesheet,
    layout: params,
    wheelSensitivity: 0.3,
  };

  if (cytoscapeInit.container) {
    window.cy = cytoscape(cytoscapeInit);
    pane.cy = window.cy;
    const cy = pane.cy;

    if (data.cyImport) {
      cy.json(data.cyImport);
    } else {
      cy.add(elements);
    }
    const nodes = cy
      .elements()
      .nodes()
      .map(d => ({ data: d.data() }));

    setElementMapper(cy, {
      nodes: nodes,
      edges: cy
        .elements()
        .edges()
        .map(d => ({ data: d.data() })),
    });

    cy.startBatch();
    // init props used from elsewhere
    cy.params = params;
    cy.paneId = pane.id;
    cy.stylesheet = stylesheet;
    setPublicVars(cy, vars);
    setStyles(cy);
    bindListeners(cy);
    setPane(pane.id, { make: true });
    initHTML(cy);
    cy.endBatch();

    initControls(cy);

    spawnPCP(cy, cy.nodes().map(n => n.data()));
    dispatchEvent(events.GLOBAL_PROPAGATE);
    return cy;
  }
  return null;
}

function haveCommonNodes(array1, obj2) {
  var isInclude = null;
  if (array1 && obj2) {
    array1.forEach(i => {
      Object.keys(obj2).forEach((key) => {
        const list = obj2[key].spawnerNodes;
        if (list?.includes(array1[i])) {
          isInclude = key;
        }
      });
    });
  }
  return isInclude;
}

async function checkSpawnNodes(cy, nodes) {
  const nodesId = nodes.map((n) => n.id);
  var allSpawnerNodes = {};
  const panes = getPanes();
  Object.keys(getPanes()).forEach((paneId) => {
    const spawnerNodes = getPanes()[paneId].spawnerNodes;
    allSpawnerNodes[paneId] = spawnerNodes;
  });

  if (allSpawnerNodes && Object.keys(allSpawnerNodes).length > 0) {
    const common = haveCommonNodes(nodesId, panes);
    if (common) {
      Swal.fire({
        title: 'Node(s) already explored',
        text: 'The nodes have been explored in another pane',
        icon: 'warning',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#555',
        confirmButtonText: 'Go to pane',
        denyButtonText: 'Expand anyway',
      }).then((result) => {
        if (result.isConfirmed) {
          return highlightPaneById(common);
        } else if (result.isDenied) {
          return fetchAndSpawn(cy, nodes);
        }
      });
    } else {
      fetchAndSpawn(cy, nodes);
    }
  } else {
    return fetchAndSpawn(cy, nodes);
  }
}

// creates new pane and then spawns graph
function spawnGraphOnNewPane(cy, nodes) {
  if (nodes.length === 0) {
    return; // console.error?
  }

  checkSpawnNodes(cy, nodes);
}

async function fetchAndSpawn(cy, nodes) {
  if (!nodes.length) return;

  const res = await fetch(
    BACKEND
      + PROJECT
      + '/outgoing?id='
      + nodes.map((n) => n.id).join('&id='),
  );
  const data = await res.json();

  const nodesIds = data.nodes
    .map((node) => node.id)
    .filter((id) => !id.includes('t_'));
  const spawnerNodes = nodes.map((n) => n.id);

  const newPanePosition = cy.vars['panePosition'];
  const pane = spawnPane(
    { // pane that spawns the new one
      spawner: cy.container().parentElement.id,
      id: null,
      newPanePosition,
    },
    nodesIds,
    spawnerNodes,
  );

  let vars = {};
  if (cy.vars) {
    const varsValues = {};
    Object.keys(cy.vars).forEach((k) => {
      if (cy.vars[k].avoidInClone) {
        return;
      }
      varsValues[k] = {
        value: cy.vars[k].value,
      };
    });
    vars = structuredClone(varsValues);
  }
  spawnGraph(pane, data, structuredClone(cy.params), vars, nodes);
}

async function expandBestPath(cy, allSources) {
  const sources = allSources.filter(s => !s.data()
    ?.details[CONSTANTS.atomicPropositions][CONSTANTS.ap_end]
    ?.value);

  // open everything, as there is no decider / DOI / scheduler
  if (cy.vars['scheduler'].value === '_none_') {
    await expandGraph(cy, sources, () => {
      const ids = sources.map(src => getNextInPath(cy, src.data().id).next).flat();
      const nexts = cy.nodes('#' + ids.join(', #'));
      iteration += 1;

      if (iteration < maxIteration && nexts) {
        expandBestPath(cy, nexts);
      }
    });
  } else { // follow only the "best" path according to DOI/scheduler
    await expandGraph(cy, sources, () => {
      const ids = sources.map(src => getNextBestInPath(cy, src.data().id).bestNext);
      const nextBests = cy.nodes('#' + ids.join(', #'));
      iteration += 1;

      if (iteration < maxIteration && nextBests) {
        expandBestPath(cy, nextBests);
      }
    });
  }
}

// for a state, returns best next state based on DOI/scheduler
function getNextBestInPath(cy, sourceNodeId) {
  if (cy.$(`#${sourceNodeId}`).outgoers().length === 0) {
    return { cy, bestNext: sourceNodeId };
  }

  let bestValue = 0;
  let bestNext = '';
  let tId = '';

  // chooses next best action
  cy.edges().forEach((n) => {
    const source = n.data().source;
    const target = n.data().target;

    if (target && target.startsWith('t_')) {
      const node = cy.elementMapper.nodes.get(target);
      if (node && node.data.scheduler && source === sourceNodeId) {
        const nodeSchedulerValue = node.data.scheduler[cy.vars['scheduler'].value];
        if (nodeSchedulerValue >= bestValue) {
          bestValue = nodeSchedulerValue;
          bestNext = target;
          tId = target;
        }
      }
    }
  });

  // chooses next best state, from the selected action
  cy.edges().forEach((n) => {
    const source = n.data().source;
    const target = n.data().target;

    if (source && source.startsWith('t_') && source === tId) {
      const node = cy.elementMapper.nodes.get(source);
      if (node && node.data.scheduler) {
        const nodeSchedulerValue = node.data.scheduler[cy.vars['scheduler'].value];
        if (nodeSchedulerValue >= bestValue) {
          bestValue = nodeSchedulerValue;
          bestNext = target;
          tId = source;
        }
      }
    }
  });

  return { cy, bestNext: cy.elementMapper.nodes.get(bestNext).data.id };
}

// for a state, returns all possible next states
function getNextInPath(cy, sourceNodeId) {
  if (cy.$(`#${sourceNodeId}`).outgoers().length === 0) {
    return { cy, next: sourceNodeId };
  }

  // gathers children actions
  const nextActions = cy
    .$(`#${sourceNodeId}`)
    .outgoers('node.t')
    .map(n => n.data().id);

  // gathers states children to the actions
  const next = cy
    .$('#' + nextActions.join(', #'))
    .outgoers('node.s')
    .map(n => n.data().id);

  return { cy, next };
}

// for a state, returns all states that led to it
function getPreviousInPath(cy, sourceNodeId) {
  if (cy.$(`#${sourceNodeId}`).incomers().length === 0) {
    return { cy, prev: sourceNodeId };
  }

  // gathers children actions
  const prevActions = cy
    .$(`#${sourceNodeId}`)
    .incomers('node.t')
    .map(n => n.data().id);

  // gathers states children to the actions
  const prev = cy
    .$('#' + prevActions.join(', #'))
    .incomers('node.s')
    .map(n => n.data().id);

  return { cy, prev };
}

function spawnPCP(cy, _nodes) {
  const nodes = _nodes || cy.$('node:selected').map(n => n.data());
  const s = nodes.filter(d => cy.vars['mode'].value.includes(d.type));
  const { pl, pld } = ndl_to_pcp(
    {
      nodes: s.length > 0 ? s
        : console.warn('tried to spawn PCP without any selection, using full nodeset')
        || cy.$('node')
          .map(n => n.data())
          .filter(d => cy.vars['mode'].value.includes(d.type)),

    },
    cy.vars['details'].value,
  );

  const hidden = new Set(['color']);
  const props = Object.keys(pld).filter(k => !hidden.has(k));

  cy.pcp = parallelCoords(
    getPanes()[cy.paneId],
    pl,
    {
      data_id: 'id',
      nominals: props.filter(k => pld[k].type === 'nominal'),
      booleans: props.filter(k => pld[k].type === 'boolean'),
      numbers: props.filter(k => pld[k].type === 'number'),
      pld,
    },
  );

  cy.paneFromPCP = (pane) => {
    spawnGraphOnNewPane(pane.cy, pane.cy.pcp.getSelection());
  };
}

/// /////////////////////////////////////////////////////////////////////////////////////
//  INTERACTIONS: Everything below here could be refactored to other files
/// /////////////////////////////////////////////////////////////////////////////////////

function unbindListeners(cy) {
  // clean listeners
  cy.off('tap cxttapstart grabon zoom pan');
  cy.off('select boxselect box tapselect tapunselect dbltap');
  cy.off('mouseover mousemove mouseout');
  cy.off('tap', 'edge');
  if (cy.ctxmenu) {
    cy.ctxmenu.destroy();
  }
}

function bindListeners(cy) {
  unbindListeners(cy);
  cy.edges().unselectify();

  // new listeners
  cy.on('tap', (e) => {
    if (e.target === cy) {
      setPane(cy.paneId);
      hideAllTippies();
    }
  });

  cy.on('cxttapstart', () => {
    setPane(cy.paneId);
    hideAllTippies();
  });

  ctxmenu(cy);

  cy.on('grabon', (e) => {
    setPane(cy.paneId);
    if (!e.originalEvent.shiftKey) {
      hideAllTippies();
    }
  });

  cy.on('tap', 'edge', () => {
    setPane(cy.paneId);
    hideAllTippies();
  });

  cy.on('zoom pan', () => {
    setPane(cy.paneId);
    hideAllTippies();
  });

  cy.on('boxselect tapselect tapunselect', _.debounce(() => {
    // automatically syncs node selection to the PCP
    const nodes = cy.$('node:selected');
    if (
      nodes.length > 0 // needed for tapunselect
      && cy.vars['fullSync'].value
    ) {
      spawnPCP(cy);
    }
  }, THROTTLE_DEBOUNCE_DELAY));

  cy.on('box', (e) => {
    if (cy.keyboard?.shiftKey && e.target.selected()) {
      e.target.unselect();
      e.target.unselectify();
      cy.pendingSelectify = true;
    };
  });

  // ensure that selections don't go away when clicking the background once
  cy.on('tap', (e) => {
    if (e.target === cy) { // background
      cy.nodes().unselectify();
      cy.pendingSelectify = true;
    } else {
      selectifyByMode(cy);
    }
  });

  // re-enable selections after the previous check happened
  cy.on('dbltap mousemove', () => {
    cy.pendingSelectify &&= (selectifyByMode(cy) && false);
  });

  cy.on('select boxselect', 'node.s', (e) => {
    handleEditorSelection(e, cy);
  });

  cy.on('tap', 'node', (e) => {
    const n = e.target;
    setPane(cy.paneId);

    if (!e.originalEvent.shiftKey) {
      hideAllTippies();
    }

    if (e.originalEvent.shiftKey) {
      const g = n.data();
      const $links = [];
      const details = cy.vars['details'].value;
      Object.keys(details).forEach(d => {
        const show = details[d].all
          || Object.values(
            details[d].props,
          ).reduce((a, b) => a || b, false);

        if (show) {
          $links.push(
            h('p', {}, [t(`==== ${d} ====`)]),
            ...Object.keys(details[d].props)
              .filter(p => details[d].props[p])
              .map(k => {
                if (details[d].metadata[k].type === 'number') {
                  return h('p', {}, [t(k + ': ' + fixed(g.details[d][k]) + '\n ')]);
                } else {
                  return h('p', {}, [t(k + ': ' + (g.details[d][k]) + '\n ')]);
                }
              }),
          );
        }
      });

      makeTippy(n, h('div', {}, $links), `tippy-${g.id}`);
    }
  });

  cy.on('dbltap', 'node', (e) => {
    const n = e.target;
    hideAllTippies();

    if (
      (e.originalEvent.altKey || e.originalEvent.ctrlKey)
      && n.classes().filter(c => c === 's').length > 0
    ) {
      spawnGraphOnNewPane(cy, [n.data()]);
    } else {
      expandGraph(cy, [n]);
    }
  });

  cy.on('mouseover', 'node', (e) => {
    var node = e.target;
    const nodeId = node.id();
    markRecurringNodesById(nodeId);
  });

  cy.on('mouseout', 'node', () => {
    unmarkRecurringNodes();
  });
}

function selectifyByMode(cy) {
  cy.nodes().selectify();

  const mode = cy.vars['mode'].value;
  if (mode === 's') {
    cy.$('node.t').unselectify();
  } else if (mode === 't') {
    cy.$('node.s').unselectify();
  }
}

// functions called from other to set variables (see setPublicVars below)
function setSelectMode(cy, mode = 's') {
  cy.vars['mode'].value = mode;
  cy.startBatch();
  cy.nodes().unselect();
  // adjust selection styles
  if (mode === 's') { // states
    cy.style().selector('core').css({ 'selection-box-color': colors.SELECTED_NODE_COLOR });
    cy.$('node.t').unselectify();
  } else if (mode === 't') { // actions / transitions
    cy.style().selector('core').css({ 'selection-box-color': colors.SECONDARY_SELECTION });
    cy.$('node.s').unselectify();
  } else if (mode === 's+t') { // both
    cy.style().selector('core').css({ 'selection-box-color': colors.DUAL_SELECTION });
  }

  cy.style().update();
  cy.endBatch();
}

// if there are properties 'missing', an update is 'missing'.
function setUpdateState(cy) {
  const props = cy.vars['details'].value[CONSTANTS.results].metadata;
  let decided = false;

  Object.keys(props).forEach(k => {
    if (decided) return;

    if (info[CONSTANTS.results][k].status !== CONSTANTS.STATUS.ready) {
      cy.vars['update'].value = CONSTANTS.STATUS.missing;
      decided = true;
    }
  });

  if (!decided) {
    cy.vars['update'].value = CONSTANTS.STATUS.ready;
  }
}

function updateDetailsToShow(cy, { update }) {
  const props = {};
  const details = structuredClone(info);

  let init = true;
  if (update) {
    init = false;
  }

  let mode = CONSTANTS.results;
  const ready = details[CONSTANTS.results]
    && Object.values(details[CONSTANTS.results])
      .map(a => a.status === CONSTANTS.STATUS.ready)
      .reduce((a, b) => a && b, true);

  if (!ready) {
    mode = CONSTANTS.variables;
  }

  Object.keys(details).forEach(d => {
    if (d === CONSTANTS.metadata) {
      return;
    }

    let truthVal = false;
    if (d === mode) {
      truthVal = true;
    }

    props[d] = {
      all: init ? truthVal : update[d].all,
      props: {},
      metadata: {},
    };

    Object.keys(details[d]).forEach(p => {
      const iv = truthVal || (
        d === CONSTANTS.results
        && info[d][p].status === CONSTANTS.STATUS.ready
      );
      props[d].props[p] = init ? iv : update[d].props[p];
      props[d].metadata[p] = info[d] ? info[d][p] : undefined;
    });
  });

  cy.vars['details'].value = props;
  spawnPCP(cy);
}

function updateScheduler(cy, prop) {
  cy.vars['scheduler'].value = prop;
  setStyles(cy);
  cy.resize();
}

function updateNewPanePosition(cy, prop) {
  cy.vars['panePosition'].value = prop;
}

function toggleFullSync(cy, prop) {
  cy.vars['fullSync'].value = prop;
}

function selectBasedOnAP(cy, e, ap) {
  e && e.preventDefault();

  if (info.metadata.initial !== '#') {
    cy.nodes().deselect();
    const states = cy.nodes('.s')
      .filter(d => d.data().details[CONSTANTS.atomicPropositions][ap]);

    if (states.length > 0) {
      states.select();

      if (cy.vars['fullSync'].value) {
        spawnPCP(cy);
      }
    }
  }
}

function mark(cy, selection) {
  const node = cy.$('#' + selection.join(', #'));
  node.addClass('marked');
}

function unmark(cy, selection) {
  const node = cy.$('#' + selection.join(', #'));
  node.removeClass('marked');
}

async function importCy(cy) {
  await Swal.fire({
    title: 'Import Model to Pane',
    html: `
        <p> Select .json file to import to the Graph View </p>
        <label style="float:left;margin-bottom:10px" for="prism-model">Choose a model file:</label>
        <div class="ui file input">
            <input id="import-graph" type="file" accept=".json" multiple>
        </div>
        `,
    focusConfirm: false,
    confirmButtonText: 'Import',
    confirmButtonColor: 'green',

    preConfirm: () => {
      const input = document.getElementById('import-graph');
      if (input.value) {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
          // const backup = {
          //   nodes: Array.from(cy.elementMapper.nodes.values()),
          //   edges: Array.from(cy.elementMapper.edges.values()),
          //   info: info,
          // };

          const data = {
            nodes: [],
            edges: [],
            info: info,
            cyImport: JSON.parse(e.target.result),
          };

          let vars = {};
          if (cy.vars) {
            const varsValues = {};
            Object.keys(cy.vars).forEach(k => {
              if (cy.vars[k].avoidInClone) {
                return;
              }
              varsValues[k] = {
                value: cy.vars[k].value,
              };
            });
            vars = structuredClone(varsValues);
          }
          cy = spawnGraph(
            getPanes()[cy.paneId],
            data,
            structuredClone(cy.params),
            vars,
          );
          setPane(cy.paneId, { make: true, force: true }); // reset sidebar to new content
          dispatchEvent(events.GLOBAL_PROPAGATE);
        };
        reader.readAsText(file);
      }
    },
  });
}

async function exportCyList(cyList) {
  if (cyList && cyList.length > 0) {
    var jsonDataList = [];
    cyList.forEach((cy) => {
      const paneData = cy.json();
      jsonDataList.push(paneData);
    });
    downloadJSONsAsZip(jsonDataList);
  }
}

async function downloadJSONsAsZip(jsonDataList) {
  const zip = new JSZip();
  await Swal.fire({
    title: 'Export Models in the Panes',
    text: 'Downloads Graph View contents as .zip',
    icon: 'warning',
    showCancelButton: true,
    showDenyButton: false,
    confirmButtonColor: 'green',
    cancelButtonColor: '#555',
    confirmButtonText: 'Download',
  }).then((result) => {
    if (result.isConfirmed) {
      try {
        // Fetch each JSON file and add it to the zip
        jsonDataList.forEach((jsonData, i) => {
          const blob = new Blob([JSON.stringify(jsonData)], {
            type: 'application/json',
          });
          zip.file(`graph${i + 1}.json`, blob);
        });
        zip.generateAsync({ type: 'blob' }).then((zipBlob) => {
          const downloadLink = document.createElement('a');
          downloadLink.href = URL.createObjectURL(zipBlob);
          downloadLink.download = 'graph_files.zip';
          downloadLink.click();
        });
      } catch (error) {
        console.error('Error:', error);
      }
    }
  });
}

async function exportCy(cy, selection) {
  await Swal.fire({
    title: 'Export Model in Pane',
    text: 'Downloads Graph View content as .json',
    icon: 'warning',
    showCancelButton: true,
    showDenyButton: false,
    confirmButtonColor: 'green',
    cancelButtonColor: '#555',
    confirmButtonText: 'Download',
  }).then((result) => {
    if (result.isConfirmed) {
      const paneData = cy.json();

      if (selection) {
        let setSelect = new Set(selection);
        paneData.elements.nodes = paneData.elements.nodes.filter(node => {
          return (
            setSelect.has(node.data.id)
            || !cy.vars['mode'].value.includes(node.data.type)
          );
        });

        setSelect = new Set(paneData.elements.nodes.map(d => d.data.id));

        paneData.elements.edges &&= paneData.elements.edges.filter(edge => {
          return (
            setSelect.has(edge.data.source)
            && setSelect.has(edge.data.target)
          );
        });
      }

      const dataStr = 'data:text/json;charset=utf-8,'
        + encodeURIComponent(JSON.stringify(paneData));
      const dl = document.getElementById('download');
      dl.setAttribute('href', dataStr);
      dl.setAttribute('download', `graph-${cy.paneId}.json`);
      dl.click();
    }
  });
}

// non-standard attempt to organize the 'public interface' of this js file
function setPublicVars(cy, preset) {
  cy.vars = {
    ur: {
      value: cy.undoRedo(),
      avoidInClone: true, // workaround for structuredClone
      fn: _.throttle(keyboardShortcuts, THROTTLE_DEBOUNCE_DELAY),
    },
    mode: {
      value: 's',
      fn: setSelectMode,
    },
    details: {
      value: 'r',
      fn: updateDetailsToShow,
    },
    scheduler: {
      value: undefined,
      fn: updateScheduler,
    },
    panePosition: {
      value: 'end',
      fn: updateNewPanePosition,
    },
    fullSync: {
      value: true,
      fn: toggleFullSync,
    },
    update: {
      value: CONSTANTS.STATUS.ready,
      fn: () => {
        renewInfo(cy);
        updateDetailsToShow(cy, { update: cy.vars['details'].value });
        setUpdateState(cy);
      },
    },
  };

  cy.fns = {
    import: importCy,
    export: exportCy,
    mark: mark,
    'undo-mark': unmark,
  };

  // call functions that need to be init
  if (Object.keys(preset).length === 0) {
    setSelectMode(cy, 's');
    updateDetailsToShow(cy, { update: false });
    updateScheduler(cy, '_none_');
  } else {
    setSelectMode(cy, preset['mode'].value);
    updateDetailsToShow(cy, { update: preset['details'].value });
    updateScheduler(cy, preset['scheduler'].value);
    updateNewPanePosition(cy, preset['panePosition'].value);
    toggleFullSync(cy, preset['fullSync']);
  }
  setUpdateState(cy);
}

function duplicatePane(cy, initSpawner) {
  const data = {
    nodes: Array.from(cy.elementMapper.nodes.values()),
    edges: Array.from(cy.elementMapper.edges.values()),
    info: info,
    cyImport: cy.json(),
  };

  const nodesIds = data.nodes
    .map((node) => node.data?.id)
    .filter((id) => !id.includes('t_'));

  const sourcePaneId = cy.container().parentElement.id;

  const panes = getPanes();
  const paneData = panes[sourcePaneId];

  const spawnerNodes = paneData.spawnerNodes;
  const pane = spawnPane(
    {
      // spawner: cy.container().parentElement.id,
      spawner: initSpawner || paneData.spawner,
      id: 'DUPLICATE-' + cy.paneId + '-' + Math.random(), // TODO make monotonically increasing instead of random
    },
    nodesIds,
    spawnerNodes,
  );

  let vars = {};
  if (cy.vars) {
    const varsValues = {};
    Object.keys(cy.vars).forEach((k) => {
      if (cy.vars[k].avoidInClone) {
        return;
      }
      varsValues[k] = {
        value: cy.vars[k].value,
      };
    });
    vars = structuredClone(varsValues);
  }

  spawnGraph(pane, data, structuredClone(cy.params), vars);
  return pane;
}

function duplicatePanes(selectedPanes) {
  const panes = getPanes();
  var duplicatedPanes = [];
  selectedPanes.forEach((pane) => {
    var initSpawnerId = '';
    const cy = pane.paneCy;
    const sourcePaneId = cy.container().parentElement.id;
    const paneData = panes[sourcePaneId];
    const spawner = paneData.spawner;
    if (duplicatedPanes.length > 0) {
      duplicatedPanes.forEach((duplPane) => {
        if (duplPane?.id?.includes(spawner)) {
          initSpawnerId = duplPane?.id;
        }
      });
    }

    const duplicatedPane = duplicatePane(cy, initSpawnerId);
    duplicatedPanes.push(duplicatedPane);
  });
}

function unmarkRecurringNodes() {
  const panes = getPanes();
  Object.keys(panes).forEach((paneId) => {
    const paneCy = panes[paneId].cy;
    paneCy.nodes().removeClass('recurring');
  });
}

function markRecurringNodes() {
  const panes = getPanes();
  const duplicates = {};
  Object.keys(panes).forEach((paneId) => {
    const nodesIds = panes[paneId].nodesIds;
    nodesIds.forEach((nodeId) => {
      if (duplicates[nodeId]) {
        duplicates[nodeId].add(paneId);
      } else {
        duplicates[nodeId] = new Set([paneId]);
      }
    });
  });

  const recurringNodes = {};
  Object.keys(duplicates).forEach((nodeId) => {
    const duplicatePanes = duplicates[nodeId];
    if (duplicatePanes.size > 1) {
      recurringNodes[nodeId] = duplicatePanes;

      duplicatePanes.forEach((paneId) => {
        const paneCy = panes[paneId].cy;
        paneCy.$('#' + nodeId).addClass('recurring');
      });
    }
  });
}

function markRecurringNodesById(markId, showInOverview = false) {
  const panes = getPanes();
  const duplicates = {};
  Object.keys(panes).forEach((paneId) => {
    const nodesIds = panes[paneId].nodesIds;
    nodesIds.forEach((nodeId) => {
      if (markId === nodeId) {
        if (duplicates[nodeId]) {
          duplicates[nodeId].add(paneId);
        } else {
          duplicates[nodeId] = new Set([paneId]);
        }
      }
    });
  });

  var recurringNodes = {};
  Object.keys(duplicates).forEach((nodeId) => {
    const duplicatePanes = duplicates[nodeId];
    if (duplicatePanes.size > 1) {
      recurringNodes[nodeId] = duplicatePanes;
      duplicatePanes.forEach((paneId) => {
        const paneCy = panes[paneId].cy;
        paneCy.$('#' + nodeId).addClass('recurring');
      });
    }
    if (showInOverview) {
      socket.emit('duplicate pane ids', duplicatePanes);
    }
  });
}

function resetPaneNodeMarkings() {
  socket.emit('reset pane-node markings');
}

function mergePane(panesToMerge, cy, prevSpawners) {
  var data = {
    nodes: Array.from(cy.elementMapper.nodes.values()),
    edges: Array.from(cy.elementMapper.edges.values()),
    info: info,
    cyImport: cy.json(),
  };
  var spawnerIds = prevSpawners || panesToMerge.map((p) => p.paneId);
  var spawnerNodes = [];

  const allPanes = getPanes();

  if (panesToMerge.length > 0) {
    panesToMerge.forEach((paneData) => {
      data = {
        nodes: data.nodes.concat(paneData.nodes),
        edges: data.edges.concat(paneData.edges),
        info: info,
        cyImport: cy.json(),
      };
      spawnerNodes.push(allPanes[paneData.paneId]?.spawnerNodes);
    });

    const nodesIds = data.nodes
      .map((node) => node.data?.id)
      .filter((id) => !id.includes('t_'));
    const pane = spawnPane(
      {
        spawner: spawnerIds,
        id: 'MERGED-' + spawnerIds.join('-'),
      },
      nodesIds,
      spawnerNodes,
    );

    let vars = {};
    if (cy.vars) {
      const varsValues = {};
      Object.keys(cy.vars).forEach((k) => {
        if (cy.vars[k].avoidInClone) {
          return;
        }
        varsValues[k] = {
          value: cy.vars[k].value,
        };
      });
      vars = structuredClone(varsValues);
    }

    const elements = {
      nodes: data.nodes.map((d) => {
        return {
          group: 'nodes',
          data: d.data,
        };
      }),
      edges: data.edges.map((edge) => {
        const d = edge.data;
        return {
          group: 'edges',
          data: {
            id: d.id,
            label: d.label,
            source: d.source,
            target: d.target,
          },
        };
      }),
    };
    data.cyImport.elements = elements;
    spawnGraph(pane, data, structuredClone(cy.params), vars);
  }
}

function mergePanes(panesToMerge, paneCy) {
  if (panesToMerge && panesToMerge.length > 0) {
    Swal.fire({
      title: 'Merge Panes',
      text: 'Do you want to keep the merged panes? ',
      icon: 'warning',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#555',
      confirmButtonText: 'Keep merged panes',
      denyButtonText: 'Remove merged panes',
    }).then((result) => {
      if (result.isConfirmed) {
        mergePane(panesToMerge, paneCy);
      } else if (result.isDenied) {
        const paneIds = panesToMerge.map((p) => p.paneId);
        const panes = getPanes();
        const prevSpawners = [];
        paneIds.forEach((id) => {
          const paneData = panes[id];
          if (paneData?.spawner) {
            prevSpawners.push(paneData?.spawner);
          }

          destroyPanes(id);
        });
        mergePane(panesToMerge, paneCy, prevSpawners);
      }
    });
  }
}

function handleMergePane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 1) {
    mergePanes(selectedPanesData.selectedPanes, selectedPanesData.paneCy);
  }
}

function handleDeletePane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    selectedPanesData.selectedPanes.forEach((pane) => {
      destroyPanes(pane.paneId, true);
    });
  }
}

function handleDuplicatePane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    // selectedPanesData.selectedPanes.forEach((pane) => {
    //   duplicatePane(pane.paneCy);
    // });

    duplicatePanes(selectedPanesData.selectedPanes);
  }
}

function handleExpandPane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    selectedPanesData.selectedPanes.forEach((pane) => {
      const paneId = pane.paneId;

      const paneDiv = document.getElementById(paneId);
      expandPane(paneDiv);
    });
  }
}

function handleCollapsePane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    selectedPanesData.selectedPanes.forEach((pane) => {
      const paneId = pane.paneId;

      const paneDiv = document.getElementById(paneId);
      collapsePane(paneDiv);
    });
  }
}

function handleExportPane() {
  if (selectedPanesData && selectedPanesData.selectedPanes.length > 0) {
    var cyList = [];
    selectedPanesData.selectedPanes.forEach((pane) => {
      cyList.push(pane.paneCy);
    });
    exportCyList(cyList);
  }
}

function handleMarkNodes(cy) {
  const targets = cy.$('node:selected');
  if (targets.length > 0) {
    if (!targets.classes().includes('marked')) {
      dispatchEvent(events.GLOBAL_MARK(targets.map(t => t.data().id)));
    } else {
      dispatchEvent(events.GLOBAL_UNMARK(targets.map(t => t.data().id)));
    }
  }
  document.activeElement.blur();
}

function initControls(cy) {
  document.getElementById(`${cy.paneId}-expand1`).addEventListener('click', (e) => {
    const modifier = (e.ctrlKey || e.altKey);
    if (modifier) {
      spawnGraphOnNewPane(cy, cy.$('node.s:selected').map(n => n.data()));
    } else {
      expandGraph(cy, cy.$('node.s:selected'));
    }
    document.activeElement.blur();
  });

  document.getElementById(`${cy.paneId}-expandN`).addEventListener('click', () => {
    iteration = 0;
    expandBestPath(cy, cy.$('node.s:selected'));
    document.activeElement.blur();
  });

  document.getElementById(`${cy.paneId}-mark`).addEventListener('click', (e) => handleMarkNodes(cy, e));
}

function ctxmenu(cy) {
  cy.ctxmenu = cy.contextMenus({
    menuItems: [
      // node specific
      {
        id: 'expand',
        content: CONSTANTS.INTERACTIONS.expand1.name,
        tooltipText: `${CONSTANTS
          .INTERACTIONS
          .expand1
          .description} \t (${CONSTANTS
          .INTERACTIONS
          .expand1
          .keyboard})`,
        selector: 'node.s',
        onClickFunction: () => {
          setPane(cy.paneId);
          hideAllTippies();
          expandGraph(cy, cy.$('node.s:selected'));
        },
        hasTrailingDivider: false,
      },
      /* {
        id: 'remove',
        content: 'Collapse outgoing',
        tooltipText: 'collapse outgoing',
        selector: 'node.s',
        onClickFunction: (event) => {
          const target = event.target || event.cyTarget;
          console.log('Under development!')
        },
        hasTrailingDivider: false
      }, */
      {
        id: 'expand-best-path',
        content: CONSTANTS.INTERACTIONS.expandN.name,
        tooltipText: `${CONSTANTS
          .INTERACTIONS
          .expandN
          .description} \t (${CONSTANTS
          .INTERACTIONS
          .expandN
          .keyboard})`,
        selector: 'node.s:selected',
        onClickFunction: () => {
          iteration = 0;
          expandBestPath(cy, cy.$('node.s:selected'));
        },
        hasTrailingDivider: false,
      },
      {
        id: 'mark-node',
        content: CONSTANTS.INTERACTIONS.mark.name,
        tooltipText: `${CONSTANTS
          .INTERACTIONS
          .mark
          .description} \t (${CONSTANTS
          .INTERACTIONS
          .mark
          .keyboard})`,
        selector: 'node.s',
        onClickFunction: e => {
          handleMarkNodes(cy, e);
        },
        hasTrailingDivider: true,
      },
      {
        id: 'expand-new',
        content: `${CONSTANTS.INTERACTIONS.expand1.name} on New Pane`,
        tooltipText: `${CONSTANTS
          .INTERACTIONS
          .expand1
          .description} \t (${CONSTANTS
          .INTERACTIONS
          .expand1
          .keyboard_pane})`,
        selector: 'node.s:selected',
        onClickFunction: () => {
          const nodes = cy.$('node.s:selected');
          hideAllTippies();
          spawnGraphOnNewPane(cy, nodes.map((n) => n.data()));
        },
        hasTrailingDivider: false,
      },
      {
        id: 'mark-recurring-node-pane',
        content: 'Mark recurring pane-nodes',
        tooltipText: 'Mark pane-nodes that include this node',
        selector: 'node.s:selected',
        onClickFunction: (event) => {
          const target = event.target || event.cyTarget;
          const nodeId = target.data().id;
          markRecurringNodesById(nodeId, true);
        },
        hasTrailingDivider: true,
      },
      {
        id: 'inspect-pcp',
        content: 'Inspect selection details',
        tooltipText: 'inspect selection details',
        selector: 'node:selected',
        onClickFunction: () => {
          spawnPCP(cy);
        },
        hasTrailingDivider: true,
      },

      // pane controls
      {
        id: 'fit-to-pane',
        content: 'Fit to view',
        tooltipText: 'fit to pane',
        coreAsWell: true,
        onClickFunction: () => cy.fit(),
        hasTrailingDivider: false,
      },
      {
        id: 'collapse-pane',
        content: 'Collapse/expand pane',
        tooltipText: 'collapse/expand pane',
        coreAsWell: true,
        onClickFunction: () => {
          togglePane(
            document.getElementById(
              document.getElementById('selected-pane').innerHTML,
            ),
          );
        },
        hasTrailingDivider: true,
      },
      {
        id: 'import-pane',
        content: 'Import Graph',
        tooltipText: 'import graph',
        coreAsWell: true,
        onClickFunction: () => {
          importCy(cy);
        },
        hasTrailingDivider: false,
      },
      {
        id: 'export-pane',
        content: 'Export Graph',
        tooltipText: 'export graph',
        coreAsWell: true,
        onClickFunction: () => {
          exportCy(cy);
        },
        hasTrailingDivider: true,
      },
      {
        id: 'duplicate-pane',
        content: 'Duplicate pane',
        tooltipText: 'dup-pane',
        coreAsWell: true,
        onClickFunction: () => {
          duplicatePane(cy);
        },
        hasTrailingDivider: false,
      },
      {
        id: 'destroy-pane',
        content: 'Remove pane',
        tooltipText: 'remove pane',
        coreAsWell: true,
        onClickFunction: () => {
          if (cy.paneId === 'pane-0') {
            Swal.fire({
              icon: 'error',
              title: 'Oops...',
              text: 'Cannot delete initial pane!',
            });
          } else {
            Swal.fire({
              title: 'Removing Pane(s)',
              text: 'This action cannot be reverted.',
              icon: 'warning',
              showCancelButton: true,
              showDenyButton: true,
              confirmButtonColor: '#d33',
              cancelButtonColor: '#555',
              confirmButtonText: 'Remove Current',
              denyButtonText: 'Remove All From Selected',
            }).then((result) => {
              if (result.isConfirmed) {
                destroyPanes(getPanes()[cy.paneId].id, true);
              } else if (result.isDenied) {
                destroyPanes(getPanes()[cy.paneId].id);
              }
            });
          }
        },
        hasTrailingDivider: true,
      },
      // new options
      {
        id: 'reset-pane-node-markings',
        content: 'Reset pane-node markings',
        tooltipText: 'Reset pane-node markings',
        coreAsWell: true,
        onClickFunction: () => {
          resetPaneNodeMarkings();
        },
        hasTrailingDivider: false,
      },
    ],
    menuItemClasses: ['dropdown-item'],
    contextMenuClasses: ['dropdown-menu'],
    submenuIndicator: {
      src: '/style/icons/submenu.svg',
      width: 12,
      height: 12,
    },
  });
}

function keyboardShortcuts(cy, e) {
  cy.keyboard = e;
  const modifier = (e.ctrlKey || e.altKey);

  selectifyByMode(cy);

  // ctrl+z: undo
  if (e.keyCode === 90 && modifier) {
    cy.vars['ur'].value.undo();
  }

  // ctrl+y: redo
  if (e.keyCode === 89 && modifier) {
    cy.vars['ur'].value.redo();
  }

  // ctrl+a: select all nodes
  if (e.keyCode === 65 && modifier) {
    e.preventDefault();
    cy.nodes().select();
    if (cy.vars['fullSync'].value) {
      spawnPCP(cy);
    }
  }

  // ctrl+i: select initial states
  if (e.keyCode === 73 && modifier) {
    selectBasedOnAP(cy, e, CONSTANTS.ap_init);
  }

  // ctrl+d: select deadlock states
  if (e.keyCode === 68 && modifier) {
    selectBasedOnAP(cy, e, CONSTANTS.ap_deadlock);
  }

  // ctrl+e: select end states
  if (e.keyCode === 69 && modifier) {
    selectBasedOnAP(cy, e, CONSTANTS.ap_end);
  }

  // ctrl+m: mark/unmark selected nodes
  if (e.keyCode === 77 && modifier) {
    handleMarkNodes(cy, e);
  }

  // left arrow
  if (e.keyCode === 37) {
    const sources = cy.$('node.s:selected');
    sources.deselect();

    if (modifier) {
      // go to previous pane
    } else {
      // if parents, select parents
      const ids = sources.map(src => getPreviousInPath(cy, src.data().id).prev).flat();
      const parents = cy.nodes(ids.length > 0 ? '#' + ids.join(', #') : '');
      parents.select();
      if (cy.vars['fullSync'].value) {
        spawnPCP(cy);
      }
    }
  }

  // right arrow
  if (e.keyCode === 39) {
    const sources = cy.$('node.s:selected');
    sources.deselect();

    if (modifier) {
      // go to next pane
    } else {
      // if children, select next best
      if (cy.vars['scheduler'].value === '_none_') {
        // open everything, as there is no decider / DOI / scheduler
        const ids = sources.map(src => getNextInPath(cy, src.data().id).next).flat();
        const nexts = cy.nodes(ids.length > 0 ? '#' + ids.join(', #') : '');
        nexts.select();
      } else {
        // follow only the "best" path according to DOI/scheduler
        const ids = sources.map(src => getNextBestInPath(cy, src.data().id).bestNext);
        const nextBests = cy.nodes('#' + ids.join(', #'));
        nextBests.select();
      }

      if (cy.vars['fullSync'].value) {
        spawnPCP(cy);
      }
    }
  }

  // TODO: visual selection + shift for a single node
  // up arrow
  if (e.keyCode === 38) {
    // if siblings list, go backward
  }

  // down arrow
  if (e.keyCode === 40) {
    // if siblings list, go forward
  }

  // enter, ctrl+enter
  if (e.key === 'Enter' || e.keyCode === 13) {
    if (modifier) {
      spawnGraphOnNewPane(cy, cy.$('node.s:selected').map(n => n.data()));
    } else {
      expandGraph(cy, cy.$('node.s:selected'));
    }
  }
}

socket.on('handle selection', (data) => {
  if (data) {
    switch (data) {
      case 'merge':
        handleMergePane();
        break;
      case 'delete':
        handleDeletePane();
        break;
      case 'duplicate':
        handleDuplicatePane();
        break;
      case 'expand':
        handleExpandPane();
        break;
      case 'collapse':
        handleCollapsePane();
        break;
      case 'export':
        handleExportPane();
        break;
    }
  }
});

socket.on('handle overview nodes selected', (data) => {
  if (data) {
    var selectedPanes = [];
    var paneCy;
    data.forEach((id) => {
      const selectedPane = getPanes()[id];
      if (selectedPane) {
        paneCy = getPanes()[id].cy;
        const data = {
          nodes: Array.from(paneCy.elementMapper.nodes.values()),
          edges: Array.from(paneCy.elementMapper.edges.values()),
          info: info,
          cyImport: paneCy.json(),
          paneId: paneCy.paneId,
          paneCy,
        };
        selectedPanes.push(data);
      }
    });
    selectedPanesData = {
      selectedPanes,
      paneCy,
    };
  }
});

export {
  spawnGraph,
  markRecurringNodes,
  unmarkRecurringNodes,
  setMaxIteration,
  mergePane,
  handleMergePane,
};
