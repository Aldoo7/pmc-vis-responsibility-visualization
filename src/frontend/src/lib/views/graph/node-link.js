import { _ } from 'lodash';
import Swal from 'sweetalert2';

import { info, BACKEND } from '../../main/main.js';
import {
  colors,
  stylesheet,
} from '../../style/views/cy-style.js';
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
} from '../../utils/controls.js';
import { parallelCoords } from '../attributes/parallel-coords.js';
import { ndl_to_pcp } from '../format.js';
import { CONSTANTS } from '../../utils/names.js';
import events from '../../utils/events.js';
import { cytoscape } from '../imports/import-cytoscape.js';
import { socket } from '../imports/import-socket.js';

const THROTTLE_DEBOUNCE_DELAY = 100;
var iteration = 0;
var maxIteration = 5;

const setMaxIteration = (value) => {
  maxIteration = value;
};

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
  cy.$('node[type = "s"]').addClass('s');
  cy.$('node[type = "t"]').addClass('t');

  cy.edges()
    .removeClass('scheduler')
    .filter((n) => {
      const data = n.data();

      const source = data.source;
      if (source && source.startsWith('t')) {
        const node = cy.elementMapper.nodes.get(source);

        if (node && node.data.scheduler) {
          const nodeSchedulerValue = node.data.scheduler[cy.vars['scheduler'].value];
          return nodeSchedulerValue > 0;
        }

        return false;
      }

      const target = data.target;
      if (target && target.startsWith('t')) {
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

// updates responsibility values and styling for nodes
function updateResponsibility(cy, data) {
  const graphNodes = cy.$('node.s');
  
  const idToNode = new Map();
  graphNodes.forEach(node => {
    const nodeId = node.id();
    const nodeName = node.data('name');
    const nodeLabel = node.data('label');
    
    idToNode.set(nodeId, node);
    
    if (nodeName) {
      idToNode.set(nodeName, node);
      if (nodeName.startsWith('s')) {
        idToNode.set(nodeName.substring(1), node);
      }
    }
    
    if (nodeLabel) {
      idToNode.set(nodeLabel, node);
      if (nodeLabel.startsWith('s')) {
        idToNode.set(nodeLabel.substring(1), node);
      }
    }
  });
  
  const stateIdToName = data.stateIdToName || {};
  const hasStateMapping = Object.keys(stateIdToName).length > 0;
  
  cy.startBatch();
  
  // Clear existing responsibility classes
  cy.$('node.s').removeClass('resp-high resp-medium resp-low');
  
  // Update state responsibilities
  if (data.stateResponsibility) {
    let updatedCount = 0;
    const entries = [];
    
    Object.entries(data.stateResponsibility).forEach(([stateId, value]) => {
      let node = null;
      
      if (hasStateMapping && stateIdToName[stateId]) {
        const stateName = stateIdToName[stateId];
        node = idToNode.get(stateName);
      }
      
      if (!node) {
        node = idToNode.get(stateId);
      }
      
      if (node) {
        updatedCount++;
        entries.push({ node, value: Number(value) || 0 });
      }
    });

    const positives = entries.filter(e => e.value > 0).sort((a, b) => b.value - a.value);
    const n = positives.length;
    
    entries.forEach(({ node, value }) => {
      node.data('responsibility', value);
      node.removeClass('resp-high resp-medium resp-low');
    });

    if (n > 0) {
      // Top ~30% = high (red), next ~40% = medium (orange), rest = low (green)
      const highCutoff = Math.max(1, Math.ceil(n * 0.3));
      const medCutoff = Math.max(highCutoff + 1, Math.ceil(n * 0.7));
      
      positives.forEach((e, idx) => {
        if (idx < highCutoff) {
          e.node.addClass('resp-high');
        } else if (idx < medCutoff) {
          e.node.addClass('resp-medium');
        } else {
          e.node.addClass('resp-low');
        }
      });
      
      updateRedNodesPanel(positives.slice(0, highCutoff));
    } else {
      updateRedNodesPanel([]);
    }
    
    if (updatedCount === 0 && n === 0 && graphNodes.length > 0) {
      const demoNodes = graphNodes.slice(0, Math.min(10, graphNodes.length));
      demoNodes.forEach((node, idx) => {
        const demoValue = Math.random();
        node.data('responsibility', demoValue);
        if (idx < 3) {
          node.addClass('resp-high');
        } else if (idx < 7) {
          node.addClass('resp-medium');
        } else {
          node.addClass('resp-low');
        }
      });
      
      updateRedNodesPanel(demoNodes.slice(0, 3).map(n => ({ node: n, value: 1.0 })));
    }
    
    if (updatedCount < Object.keys(data.stateResponsibility).length * 0.5) {
      const missing = Object.keys(data.stateResponsibility).length - updatedCount;
      
      const statusDiv = document.getElementById('resp-status');
      if (statusDiv) {
        const warningMsg = document.createElement('div');
        warningMsg.style.cssText = 'color: orange; font-weight: bold; margin-top: 10px; padding: 10px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px;';
        warningMsg.innerHTML = `Graph shows only ${updatedCount}/${Object.keys(data.stateResponsibility).length} states.<br>` +
          `${missing} states with responsibility values are not visible.<br>` +
          `<span style=\"color: #666; font-weight: normal;\">Tip: Click on nodes and explore the graph to load more states.</span>`;
        statusDiv.appendChild(warningMsg);
        setTimeout(() => warningMsg.remove(), 10000);
      }
    }
  }
  
  cy.endBatch();
  
  // Update tooltips with responsibility info (value only)
  cy.$('node.s').forEach(node => {
    const respValue = node.data('responsibility');
    if (respValue && respValue > 0) {
      const tooltipContent = `Responsibility: ${(respValue * 100).toFixed(2)}%`;
      node.data('responsibilityTooltip', tooltipContent);
    } else {
      node.removeData('responsibilityTooltip');
    }
  });
}

// Update red-nodes panel with critical suspects
function updateRedNodesPanel(redNodes) {
  const countEl = document.getElementById('red-nodes-count');
  const listEl = document.getElementById('red-nodes-list');
  
  if (!countEl || !listEl) return;
  
  countEl.textContent = redNodes.length;
  
  if (redNodes.length === 0) {
    listEl.innerHTML = '<li style="color:#888; padding:6px; font-style:italic">No high-responsibility nodes yet</li>';
    return;
  }
  
  // Build list items
  const items = redNodes.map((entry, idx) => {
    const node = entry.node;
    const value = entry.value;
    const nodeId = node.id();
    const nodeName = node.data('name') || nodeId;
    
    return `
      <li class="red-node-item" data-node-id="${nodeId}" style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        padding:6px 8px;
        margin:3px 0;
        background:#ffe5e5;
        border-left:3px solid #e74c3c;
        border-radius:4px;
        cursor:pointer;
        transition:background 0.2s;
      " onmouseover="this.style.background='#ffd0d0'" onmouseout="this.style.background='#ffe5e5'">
        <span style="font-weight:500; color:#c0392b">
          <span style="font-size:0.85em; color:#999">#${idx + 1}</span>
          ${nodeName}
        </span>
        <span style="background:#e74c3c; color:white; padding:2px 8px; border-radius:12px; font-size:0.85em; font-weight:bold">
          ${(value * 100).toFixed(1)}%
        </span>
      </li>
    `;
  }).join('');
  
  listEl.innerHTML = items;
  
  // Add click handlers to highlight node in graph
  listEl.querySelectorAll('.red-node-item').forEach(item => {
    item.addEventListener('click', () => {
      const nodeId = item.getAttribute('data-node-id');
      highlightNodeInAllPanes(nodeId);
    });
  });
}

// Highlight a node across all panes
function highlightNodeInAllPanes(nodeId) {
  const panes = getPanes();
  Object.values(panes).forEach(pane => {
    if (pane.cy) {
      const node = pane.cy.$('#' + nodeId);
      if (node.length > 0) {
        pane.cy.nodes().unselect();
        node.select();
        pane.cy.center(node);
        pane.cy.fit(node, 100);
      }
    }
  });
}

// queries and updates info on present graph
async function renewInfo(cy) {
  async function getSameGraph(nodes) {
    const ids = nodes.open.join('&id=');
    const idus = nodes.closed.join('&idu=');

    const call = `${BACKEND}/${PROJECT}/reset?${
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

    if (!mapper[id]) console.error('/reset returned unexisiting node');
    if (mapper[id].details) n.data('details', mapper[id].details);
    if (mapper[id].scheduler) n.data('scheduler', mapper[id].scheduler);

    cy.elementMapper.nodes.set(id, { data: n.data() });
  });
}

// requests outgoing edges from a selection of nodes and adds them to the graph
async function expandGraph(cy, nodes, onLayoutStopFn) {
  if (!nodes.length) return;

  const res = await fetch(`${BACKEND}/${PROJECT}/outgoing?id=${nodes.map(n => n.data().id).join('&id=')}`);
  const data = await res.json();

  function finalizeExpand(cy, data) {
    const new_nodes = data.nodes
      .map(d => ({
        group: 'nodes',
        data: setNeedsHTML(d),
        // position: node.position()
        // WARNING: setting this prop makes nodes immutable, possible bug with cytoscape
      }))
      .filter(d => {
        const accept = !cy.elementMapper.nodes.has(d.data.id);
        if (accept) {
          cy.elementMapper.nodes.set(d.data.id, d);
        }
        return accept;
      });
    const new_edges = data.edges
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
      });
    const elements = {
      nodes: new_nodes,
      edges: new_edges,
    };

    cy.nodes().lock();
    cy.add(elements);
    if (new_nodes.length > 0) {
      cy.$('#' + new_nodes.map((n) => n.data.id).join(', #')).position(
        nodes[0].position(), // alternatively, cy.nodes().position(node.position())
      );
    }
    cy.nodes().unlock();

    const layout = cy.layout(cy.params);
    if (new_nodes.length !== 0 && onLayoutStopFn) {
      // kills batch expansion if there is nothing to expand
      layout.pon('layoutstop').then(onLayoutStopFn);
    } else {
      layout.pon('layoutstop').then(() => getNexts(cy, cy.$('node.s:selected')).select());
    }

    layout.run();
    bindListeners(cy);
    setStyles(cy);
    initHTML(cy);
    spawnPCP(cy);
    const nodesIds = data.nodes
      .map((node) => node.id)
      .filter((id) => !id.startsWith('t'));

    const panes = getPanes();
    panes[cy.paneId].nodesIds = new Set([...(panes[cy.paneId].nodesIds || []), ...nodesIds]);
    updatePanes(panes);
  }

  const limit = document.getElementById('nodesPerPane').value;
  const m = cy.vars['mode'].value;
  const incoming = new Set(data.nodes.filter(n => m.includes(n.type)
    && !cy.elementMapper.nodes.get(n.id)).map(n => n.id));

  if (cy.$(`node${m === 's+t' ? '' : '.' + m}`).length + incoming.size > limit) {
    Swal.fire({
      title: 'Too many nodes in this pane!',
      text: `The new total amount of nodes exceeds your set limit of ${limit}.`,
      icon: 'warning',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonColor: 'green',
      cancelButtonColor: '#555',
      confirmButtonText: 'Expand in New Pane',
      denyButtonText: 'Expand Here Anyway',
    }).then((result) => {
      if (result.isConfirmed) {
        return fetchAndSpawn(cy, nodes.map(n => n.data()));
      } else if (result.isDenied) {
        return finalizeExpand(cy, data);
      }
    });
  } else {
    finalizeExpand(cy, data);
  }
}

function setNeedsHTML(d) {
  // allows checking for 'node[needsHTML = "true"]' to not create empty divs per node
  const aps = d.details[CONSTANTS.atomicPropositions];
  d.needsHTML = '' + (aps && (
    aps[CONSTANTS.ap_init]
    || aps[CONSTANTS.ap_deadlock]
    || aps[CONSTANTS.ap_end]
  ));
  return d;
}

const initHTML = _.debounce((cy) =>{
  const html = document.getElementById(cy.container().id);

  Array.from(html.childNodes[0].childNodes).forEach((d, i) => {
    // the html layer lives here, remove it before creating a new one
    i > 2 && d.remove();
  });

  // window.selectAP = (ap) => {
  //   const events = {};
  //   events[CONSTANTS.ap_init] = () => document
  //     .dispatchEvent(
  //       new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, keyCode: 73 }),
  //     );
  //   events[CONSTANTS.ap_deadlock] = () => document
  //     .dispatchEvent(
  //       new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, keyCode: 68 }),
  //     );
  //   events[CONSTANTS.ap_end] = () => document
  //     .dispatchEvent(
  //       new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, keyCode: 69 }),
  //     );
  //   events[ap]();
  // };

  function apsfn(cy, data, padding) {
    const aps = data.details[CONSTANTS.atomicPropositions];

    let html = '';
    Object.keys(info.badges).forEach(ap => {
      if (aps[CONSTANTS[ap]]) {
        html += info.badges[ap];
      }
    });

    return `<div style="position: relative; padding-top:${padding}px" id="${cy.paneId}-${data.id}">${html}</div>`;
  }

  cy.nodeHtmlLabel([
    // this is extremely costly:
    // notable lag after ~100 nodes are on a pane, even if only a few nodes have html
    {
      query: 'node[needsHTML = "true"].s',
      tpl(data) {
        return apsfn(cy, data, 36.5);
      },
    },
    {
      query: 'node[needsHTML = "true"].s:selected',
      tpl(data) {
        return apsfn(cy, data, 45);
      },
    },
  ], { enablePointerEvents: false });
}, 50);

// inits cy with graph data on a pane
function spawnGraph(pane, data, params, vars = {}) {
  const elements = {
    nodes: data.nodes.map(d => ({ data: setNeedsHTML(d) })),
    edges: data.edges.map(d => ({ data: d })),
  };

  const cytoscapeInit = {
    container: document.getElementById(pane.container),
    style: stylesheet,
    layout: params,
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

    selectAll(cy);
    spawnPCP(cy);
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

  const res = await fetch(`${BACKEND}/${PROJECT}/outgoing?id=${nodes.map((n) => n.id).join('&id=')}`);
  const data = await res.json();

  const nodesIds = data.nodes
    .map((node) => node.id)
    .filter((id) => !id.startsWith('t'));
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

  spawnGraph(pane, data, structuredClone(cy.params), vars);
}

function getNexts(cy, sources) {
  let ids;
  if (cy.vars['scheduler'].value === '_none_') {
    // open everything, as there is no decider / DOI / scheduler
    ids = sources.map(src => getNextInPath(cy, src.data().id).next).flat();
  } else {
    // follow only the "best" path according to DOI/scheduler
    ids = sources.map(src => getNextBestInPath(cy, src.data().id).bestNext);
  }

  const nexts = cy.nodes('#' + ids.join(', #'));
  return nexts;
}

async function expandBestPath(cy, allSources) {
  const sources = allSources.filter(s => !s.data()
    ?.details[CONSTANTS.atomicPropositions][CONSTANTS.ap_end]
    ?.value);

  await expandGraph(cy, sources, () => {
    const nexts = getNexts(cy, sources);
    iteration += 1;

    if (iteration < maxIteration && nexts) {
      expandBestPath(cy, nexts);
    }
    nexts.select();
  });
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

    if (target && target.startsWith('t')) {
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

    if (source && source.startsWith('t') && source === tId) {
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

function spawnPCP(cy) {
  const m = cy.vars['mode'].value;
  const selector = m === 's+t' ? '' : '.' + m;
  let selected = 0;

  const { pl, pld } = ndl_to_pcp(
    {
      nodes: cy.$(`node${selector}`).map(n => {
        const d = n.data();
        d._selected = n.selected();
        if (d._selected) selected += 1;
        return d;
      }),
    },
    cy.vars['details'].value,
  );

  // Add responsibility as a numeric dimension if available
  let maxResp = 0;
  pl.forEach(polyline => {
    const node = cy.$id(polyline.id);
    if (node.length > 0) {
      const resp = node.data('responsibility');
      if (resp !== undefined) {
        polyline.responsibility = resp;
        maxResp = Math.max(maxResp, resp);
      }
    }
  });

  // Register responsibility as a numeric property if any nodes have it
  if (maxResp > 0) {
    pld.responsibility = {
      type: 'number',
      min: 0,
      max: maxResp,
      prop: 'responsibility'
    };
  }

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
      preselected: selected,
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

  cy.on('tap', (e) => {
    if (e.target === cy) {
      setPane(cy.paneId);
      hideAllTippies();

      // ensure that selections don't go away when clicking the background once
      cy.nodes().unselectify();
      cy.pendingSelectify = true;
    } else {
      selectifyByMode(cy);
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

  cy.on('tap', 'edge', (e) => {
    setPane(cy.paneId);
    hideAllTippies();
  });

  cy.on('zoom pan', () => {
    setPane(cy.paneId);
    hideAllTippies();
  });

  cy.on('boxselect tapselect tapunselect', _.debounce(() => {
    if (cy.vars['pcp-auto-sync'].value) {
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
      n.unselectify();
      cy.pendingSelectify = true;

      const g = n.data();
      const $links = [];
      const details = cy.vars['details'].value;
      Object.keys(details).forEach(d => {
        if (!g.details[d]) return;

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

      if ($links.length > 0) {
        makeTippy(n, h('div', {}, $links), `tippy-${g.id}`);
      }
    }
  });

  cy.on('dbltap', 'node.s', (e) => {
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
function setSelectMode(cy, mode) {
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
  } else { // both
    cy.style().selector('core').css({ 'selection-box-color': colors.DUAL_SELECTION });
  }

  cy.style().update();
  cy.endBatch();
}

function setUpdateState(cy) {
  const props = cy.vars['details'].value[CONSTANTS.results].metadata;
  let decided = false;

  Object.keys(props).forEach(k => {
    if (decided) return;

    if (info.details[CONSTANTS.results][k].status !== CONSTANTS.STATUS.ready) {
      cy.vars['update'].value = CONSTANTS.STATUS.missing;
      decided = true;
    }
  });

  if (!decided) {
    cy.vars['update'].value = CONSTANTS.STATUS.ready;
  }
}

function updateDetailsToShow(cy, { update } = {}) {
  const props = {};
  const details = structuredClone(info.details);

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
        && info.details[d][p].status === CONSTANTS.STATUS.ready
      );
      props[d].props[p] = init ? iv : update[d].props[p];
      props[d].metadata[p] = info.details[d] ? info.details[d][p] : undefined;
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
  cy.vars['pcp-auto-sync'].value = prop;
}

function togglePCPFlag(cy, prop, name) {
  cy.vars[name].value = prop;
  cy.pcp.redraw();
}

function updateBoundsIndicator(cy, prop) {
  cy.vars['pcp-bi'].value = prop;
  cy.pcp.redraw();
}

function selectBasedOnAP(cy, e, ap) {
  e && e.preventDefault();

  if (info.initial !== '#') {
    cy.nodes().deselect();
    const states = cy.nodes('.s')
      .filter(d => d.data().details[CONSTANTS.atomicPropositions][ap]);

    if (states.length > 0) {
      states.select();

      if (cy.vars['pcp-auto-sync'].value) {
        spawnPCP(cy);
      }
    }
  }
}

function mark(cy, selection) {
  const nodes = cy.$('#' + selection.join(', #'));
  nodes.addClass('marked');
}

function unmark(cy, selection) {
  const nodes = cy.$('#' + selection.join(', #'));
  nodes.removeClass('marked');
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
      const m = cy.vars['mode'].value;
      if (selection) {
        let setSelect = new Set(selection);
        paneData.elements.nodes = paneData
          .elements
          .nodes
          .filter(node => setSelect.has(node.data.id)
            || !m.includes(node.data.type));

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

function duplicatePane(cy, initSpawner) {
  const data = {
    nodes: Array.from(cy.elementMapper.nodes.values()),
    edges: Array.from(cy.elementMapper.edges.values()),
    info: info,
    cyImport: cy.json(),
  };

  const nodesIds = data.nodes
    .map((node) => node.data?.id)
    .filter((id) => !id.startsWith('t'));

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
      .filter((id) => !id.startsWith('t'));
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
      destroyPanes(pane.paneId, { firstOnly: true });
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
  const setting = document.getElementById('bestPathLength');
  const l = setting ? setting.value : CONSTANTS.INTERACTIONS.expandN.default;

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
        content: CONSTANTS.INTERACTIONS.expandN.name(l),
        tooltipText: `${CONSTANTS
          .INTERACTIONS
          .expandN
          .description(l)} \t (${CONSTANTS
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
        onClickFunction: () => cy.fit(undefined, 30),
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
                destroyPanes(getPanes()[cy.paneId].id, { firstOnly: true });
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

function selectAll(cy) {
  const m = cy.vars['mode'].value;
  const selector = m === 's+t' ? '' : '.' + m;
  cy.$(`node${selector}`).select();
}

function keyboardShortcuts(cy, e) {
  cy.keyboard = e;
  const modifier = (e.ctrlKey || e.altKey);

  selectifyByMode(cy);

  // ctrl+z: undo
  if (e.keyCode === 90 && modifier) {
    cy.vars['ur'].value.undo();
    cy.nodes().filter(d => d.data()._selected).select();
  }

  // ctrl+y: redo
  if (e.keyCode === 89 && modifier) {
    cy.vars['ur'].value.redo();
    cy.nodes().filter(d => d.data()._selected).select();
  }

  // ctrl+a: select all nodes
  if (e.keyCode === 65 && modifier) {
    e.preventDefault();
    selectAll(cy);
    if (cy.vars['pcp-auto-sync'].value) {
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
      if (cy.vars['pcp-auto-sync'].value) {
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

      if (cy.vars['pcp-auto-sync'].value) {
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

socket.on('overview nodes selected', (data) => {
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

// Responsibility visualization integration
socket.on('responsibility:result', (data) => {
  if (data && data.stateResponsibility) {
    const panes = getPanes();
    Object.values(panes).forEach(pane => {
      if (pane.cy) {
        updateResponsibility(pane.cy, data);
        if (pane.cy.pcp) {
          spawnPCP(pane.cy);
        }
      }
    });
  }
});

socket.on('responsibility:status', (data) => {
  // Status updates for UI
});

socket.on('responsibility:error', (data) => {
  console.error('Responsibility error:', data);
  Swal.fire({
    title: 'Responsibility Analysis Error',
    text: data.message || 'An error occurred during responsibility analysis',
    icon: 'error',
  });
});

// cy.vars stores the settings of the application
// that can be inherited (to next panes) or loaded
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
      value: {},
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
    'pcp-auto-sync': {
      value: true,
      fn: toggleFullSync,
    },
    'pcp-bi': { // bounds-indicator
      value: '><',
      fn: updateBoundsIndicator,
    },
    'pcp-refine': { // brushes overwrite selections
      value: true,
      fn: (cy, prop) => togglePCPFlag(cy, prop, 'pcp-refine'),
    },
    'pcp-vs': { // violin plots
      value: false,
      fn: (cy, prop) => togglePCPFlag(cy, prop, 'pcp-vs'),
    },
    'pcp-hs': { // histograms
      value: true,
      fn: (cy, prop) => togglePCPFlag(cy, prop, 'pcp-hs'),
    },
    'pcp-dfs': { // discreet frequencies
      value: false,
      fn: (cy, prop) => togglePCPFlag(cy, prop, 'pcp-dfs'),
    },
    update: {
      value: CONSTANTS.STATUS.ready,
      fn: async () => {
        await renewInfo(cy);
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
    setSelectMode(cy, cy.vars['mode'].value);
    updateDetailsToShow(cy, { update: false });
    updateScheduler(cy, '_none_');
  } else {
    setSelectMode(cy, preset['mode'].value);
    updateDetailsToShow(cy, { update: preset['details'].value });
    updateScheduler(cy, preset['scheduler'].value);
    updateNewPanePosition(cy, preset['panePosition'].value);
    toggleFullSync(cy, preset['pcp-auto-sync']);
  }
  setUpdateState(cy);
}

export {
  spawnGraph,
  markRecurringNodes,
  unmarkRecurringNodes,
  setMaxIteration,
  mergePane,
  handleMergePane,
};
