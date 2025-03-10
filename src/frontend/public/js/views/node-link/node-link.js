import {
  colors,
  selections,
  stylesheet,
} from "../../../style/views/cy-style.js";
import {
  getPanes,
  spawnPane,
  togglePane,
  info,
  destroyPanes,
  updatePanes,
  expandPane,
  collapsePane,
  highlightPaneById,
} from "../panes/panes.js";
import { handleEditorSelection } from "../editor.js";
import {
  h,
  t,
  fixed,
  getRandomColor,
} from "../../utils/utils.js";
import {
  makeTippy,
  hideAllTippies,
  setPane,
  PROJECT,
} from "../../utils/controls.js";
import { parallelCoords } from "../parallel-coords/parallel-coords.js";
import { ndl_to_pcp } from "../format.js";
import { INTERACTIONS, NAMES } from "../../utils/names.js";
import events from "../../utils/events.js";

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
    .addClass("t")
    .filter(n => n.data().type === "s")
    .removeClass("t")
    .addClass("s");

  cy.edges()
    .removeClass("scheduler")
    .filter((n) => {
      const source = n.data().source;
      const target = n.data().target;
      if (source && source.startsWith("t_")) {
        const node = cy.elementMapper.nodes.get(source);
        if (node && node.data.scheduler) {
          const nodeSchedulerValue =
            node.data.scheduler[cy.vars["scheduler"].value];
          return nodeSchedulerValue > 0;
        }

        return false;
      }

      if (target && target.startsWith("t_")) {
        const node = cy.elementMapper.nodes.get(target);
        if (node && node.data.scheduler) {
          const nodeSchedulerValue =
            node.data.scheduler[cy.vars["scheduler"].value];
          return nodeSchedulerValue > 0;
        }

        return false;
      }
    })
    .addClass("scheduler");

  cy.endBatch();
}

// requests outgoing edges from a selection of nodes and adds them to the graph
async function graphExtend(cy, nodes, onLayoutStopFn) {
  const res = await fetch(
    "http://localhost:8080/" +
      PROJECT +
      "/outgoing?id=" +
      nodes.map(n => n.data().id).join("&id=")
  );
  const data = await res.json();

  const elements = {
    nodes: data.nodes
      .map(d => ({
        group: "nodes",
        data: d,
        //position: node.position() // WARNING: setting this prop makes nodes immutable, possible bug with cytoscape
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
        group: "edges",
        data: {
          id: d.id,
          label: d.label,
          source: d.source,
          target: d.target,
        }
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
    cy.$("#" + elements.nodes.map((n) => n.data.id).join(", #")).position(
      nodes[0].position()
    ); // alternatively, cy.nodes().position(node.position())
  }
  cy.nodes().unlock();

  const layout = cy.layout(cy.params);
  layout.pon('layoutstop').then(onLayoutStopFn);
  layout.run();

  bindListeners(cy);
  setStyles(cy);
  //initHTML(cy);

  const nodesIds = data.nodes
    .map((node) => node.id)
    .filter((id) => !id.includes("t_"));

  const panes = getPanes();
  panes[cy.paneId].nodesIds = new Set([
    ...(panes[cy.paneId].nodesIds || []), 
    ...nodesIds
  ]);
  updatePanes(panes);
}

// inits cy with graph data on a pane
function spawnGraph(pane, data, params, vars = {}, src) {
  const elements = {
    nodes: data.nodes.map(d => ({ data: d.data ? d.data : d })),
    edges: data.edges.map(d => ({ data: d.data ? d.data : d }))
  };

  const cytoscapeInit = {
    container: document.getElementById(pane.container),
    style: stylesheet,
    layout: params,
    wheelSensitivity: 0.3, 
  };

  if (cytoscapeInit.container) {
    const cy = (pane.cy = window.cy = cytoscape(cytoscapeInit));

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
        .map(d => ({ data: d.data() }))
    });

    cy.startBatch();
    // init props used from elsewhere
    cy.params = params;
    cy.paneId = pane.id;
    cy.stylesheet = stylesheet;
    setPublicVars(cy, vars);
    setStyles(cy);
    bindListeners(cy);
    setPane(pane.id, true);
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
    for (let i = 0; i < array1.length; i++) {
      Object.keys(obj2).forEach((key) => {
        const list = obj2[key].spawnerNodes;
        if (list?.includes(array1[i])) {
          isInclude = key;
        }
      });
    }
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
        title: "Node(s) already explored",
        text: "The nodes have been explored in another pane",
        icon: "warning",
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#555",
        confirmButtonText: "Go to pane",
        denyButtonText: "Expand anyway",
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
  const res = await fetch(
    "http://localhost:8080/" +
      PROJECT +
      "/outgoing?id=" +
      nodes.map((n) => n.id).join("&id=")
  );
  const data = await res.json();

  const nodesIds = data.nodes
    .map((node) => node.id)
    .filter((id) => !id.includes("t_"));
  const spawnerNodes = nodes.map((n) => n.id);

  const newPanePosition = cy.vars["panePosition"];
  const pane = spawnPane(
    { spawner: cy.container().parentElement.id, id: null, newPanePosition }, // pane that spawns the new one
    nodesIds,
    spawnerNodes
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
  const sources = allSources.filter(s => 
    !s.data()
    ?.details[NAMES.atomicPropositions][NAMES.ap_end]
    ?.value
  );

  // open everything, as there is no decider / DOI / scheduler
  if (cy.vars["scheduler"].value === "_none_") { 
    await graphExtend(cy, sources, function() {
      const ids = sources.map(src => getNextInPath(cy, src.data().id).next).flat();
      const nexts = cy.nodes("#" + ids.join(", #"));
      iteration++;
  
      if (iteration < maxIteration && nexts) {
        expandBestPath(cy, nexts);
      }
    });
  } else { // follow only the "best" path according to DOI/scheduler
    await graphExtend(cy, sources, function() {
      const ids = sources.map(src => getNextBestInPath(cy, src.data().id).bestNext);
      const nextBests = cy.nodes("#" + ids.join(", #"));
      iteration++;
  
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
  let bestNext = "";
  let tId = "";

  // chooses next best action
  cy.edges().forEach((n) => {
    const source = n.data().source;
    const target = n.data().target;

    if (target && target.startsWith("t_")) {
      const node = cy.elementMapper.nodes.get(target);
      if (node && node.data.scheduler && source === sourceNodeId) {
        const nodeSchedulerValue =
          node.data.scheduler[cy.vars["scheduler"].value];
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

    if (source && source.startsWith("t_") && source === tId) {
      const node = cy.elementMapper.nodes.get(source);
      if (node && node.data.scheduler) {
        const nodeSchedulerValue =
          node.data.scheduler[cy.vars["scheduler"].value];
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
  let pcp_data = ndl_to_pcp(
    {
      nodes: nodes.filter(d => cy.vars['mode'].value.includes(d.type))
    }, 
    cy.vars['details'].value
  );

  if (!pcp_data.length > 0) {
    console.warn('tried to spawn PCP without any selection, using full nodeset');
    pcp_data = ndl_to_pcp(
      {
        nodes: cy
          .$('node')
          .map(n => n.data())
          .filter(d => cy.vars['mode'].value.includes(d.type)),
      }, 
      cy.vars['details'].value
    );
  }

  const hidden = new Set(['color']);
  const props = Object.keys(pcp_data[0]).filter(k => !hidden.has(k));

  cy.pcp = parallelCoords(
    getPanes()[cy.paneId],
    pcp_data,
    {
      data_id: 'id',
      nominals: props.filter(k => pcp_data[0][k].type === 'nominal'),
      booleans: props.filter(k => pcp_data[0][k].type === 'boolean'),
      numbers: props.filter(k => pcp_data[0][k].type === 'numbers'),
      cols: props
    }
  );

  cy.paneFromPCP = (pane) => {
    spawnGraphOnNewPane(pane.cy, pane.cy.pcp.getSelection());
  };
}

////////////////////////////////////////////////////////////////////////////////////////
//  INTERACTIONS: Everything below here could be refactored to other files 
////////////////////////////////////////////////////////////////////////////////////////

function unbindListeners(cy) {
  // clean listeners
  cy.off('tap cxttapstart grabon zoom pan');
  cy.off('select boxselect tapselect tapunselect dbltap')
  cy.off('mouseover mousemove mouseout')
  cy.off('tap', 'edge');
  if (cy.ctxmenu) {
    cy.ctxmenu.destroy();
  }
}

function bindListeners(cy) {
  unbindListeners(cy);

  // new listeners
  cy.on('tap', function (e) {
    if (e.target === cy) {
      setPane(cy.paneId);
      hideAllTippies();
    }
  });

  cy.on('cxttapstart', function (e) {
    setPane(cy.paneId);
    hideAllTippies();
  });

  ctxmenu(cy);

  cy.on('grabon', function (e) {
    setPane(cy.paneId);
    if (!e.originalEvent.shiftKey) {
      hideAllTippies();
    }
  });

  cy.on('tap', 'edge', function (e) {
    setPane(cy.paneId);
    hideAllTippies();
  });

  cy.on('zoom pan', function (e) {
    setPane(cy.paneId);
    hideAllTippies();
  });

  cy.on("boxselect tapselect tapunselect", _.debounce(function (e) {
    // automatically syncs node selection to the PCP
    const nodes = cy.$('node:selected');
    if (
      nodes.length > 0 // needed for tapunselect
      && cy.vars["fullSync"].value
    ) { 
      spawnPCP(cy);
    }
  }, THROTTLE_DEBOUNCE_DELAY));

  // ensure that selections don't go away when clicking the background once
  cy.on('tap', (e) => {
    if (e.target === cy) { // background
      cy.nodes().unselectify();
    } else {
      cy.nodes().selectify();
    }
  });

  // re-enable selections after the previous check happened
  cy.on('dbltap mousemove', _ => {
    cy.nodes().selectify();
  });

  cy.on('select boxselect', 'node.s', function (event) {
    handleEditorSelection(event, cy);
  });

  cy.on('tap', 'node', function (e) {
    const n = e.target;
    setPane(cy.paneId);

    if (!e.originalEvent.shiftKey) {
      hideAllTippies();
    }

    if (e.originalEvent.shiftKey) {
      let g = n.data();

      const $links = [];

      const details = cy.vars['details'].value;
      Object.keys(details).forEach(d => {
        const show = details[d].all || 
          Object.values(
            details[d].props
          ).reduce((a, b) => a || b, false);

        if (show) {
          $links.push(
            h('p', {}, [t(`==== ${d} ====`)]),
            ...Object.keys(details[d].props)
              .filter(p => details[d].props[p])
              .map(k => {
                const detail = g.details[d][k];
                if (detail.type === 'numbers') {
                  return h('p', {}, [t(k + ': ' + fixed(detail.value) + '\n ')]);
                } else {
                  return h('p', {}, [t(k + ': ' + (detail.value) + '\n ')]);
                }
              })
          );
        }
      });

      makeTippy(n, h('div', {}, $links), `tippy-${g.id}`);
    }
  });

  cy.on('dbltap', 'node', function (e) {
    const n = e.target;
    hideAllTippies();
    
    if (
      (e.originalEvent.altKey || e.originalEvent.ctrlKey) 
      && n.classes().filter(c => c === 's').length > 0
    ) {
      spawnGraphOnNewPane(cy, [n.data()]);
    } else {
      graphExtend(cy, [n]);
    }
  });

  cy.on("mouseover", "node", function (event) {
    var node = event.target;
    const nodeId = node.id();
    markRecurringNodesById(nodeId);
  });

  cy.on("mouseout", "node", function (event) {
    unmarkRecurringNodes();
  });
}

// functions called from other to set variables (see setPublicVars below)
function setSelectMode(cy, mode = 's') {
  cy.vars['mode'].value = mode;

  cy.startBatch();
  //adjust selection styles
  if (mode === 's') { //states
    cy.style().selector('core').css({ 
      "selection-box-color": colors.SELECTED_NODE_COLOR, 
    });
    cy.style().selector('node.t:selected').css({
      'opacity': '0.5',
      'border-color': colors.SECONDARY_NODE_COLOR,
    });
    cy.style().selector('node.s:selected').css(selections.primary);
  } else if (mode === 't') { //actions / transitions
    cy.style().selector('core').css({ "selection-box-color": colors.SECONDARY_SELECTION });
    cy.style().selector('node.s:selected').css({
      'opacity': '0.5',
      'border-color': colors.NODE_COLOR,
    });
    cy.style().selector('node.t:selected').css(selections.secondary);
  } else if (mode === 's+t') { //both
    cy.style().selector('core').css({ "selection-box-color": colors.DUAL_SELECTION });
    cy.style().selector('node.s:selected').css(selections.primary);
    cy.style().selector('node.t:selected').css(selections.secondary);
  }

  cy.style().update();
  cy.endBatch();
}

function updateDetailsToShow(cy, { update, mode = NAMES.results }) {
  const props = {};
  const details = cy.elements()[0].data().details; // TODO: replace this with global info object. 

  let init = true;
  if (update) {
    init = false;
  }

  Object.keys(details).forEach(d => {
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
      props[d].props[p] = init ? truthVal : update[d].props[p];
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

function selectBasedOnAP(e, ap) {
  e.preventDefault(); 
  
  if (info.metadata.initial !== "#") {
    cy.nodes().deselect();
    const states = cy.nodes('.s')
      .filter(d => d.data()
        .details[NAMES.atomicPropositions][ap]
        ?.value === true
    );

    if (states.length > 0) {
      states.select();
      
      if (cy.vars['fullSync'].value) {
        spawnPCP(cy);
      }
    }
  }
}

function mark(cy, selection) {
  const node = cy.$('#' + selection.join(', #'))
  node.addClass('marked');
}

function unmark(cy, selection) {
  const node = cy.$('#' + selection.join(', #'))
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
          const backup = {
            nodes: Array.from(cy.elementMapper.nodes.values()),
            edges: Array.from(cy.elementMapper.edges.values()),
            info: info,
          };

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
            vars
          );
          setPane(cy.paneId, true, true); // reset sidebar to new content
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
    title: "Export Models in the Panes",
    text: "Downloads Graph View contents as .zip",
    icon: "warning",
    showCancelButton: true,
    showDenyButton: false,
    confirmButtonColor: "green",
    cancelButtonColor: "#555",
    confirmButtonText: "Download",
  }).then((result) => {
    if (result.isConfirmed) {
      try {
        // Fetch each JSON file and add it to the zip
        for (let i = 0; i < jsonDataList.length; i++) {
          const jsonData = jsonDataList[i];
          const blob = new Blob([JSON.stringify(jsonData)], {
            type: "application/json",
          });
          zip.file(`graph${i + 1}.json`, blob);
        }
        zip.generateAsync({ type: "blob" }).then((zipBlob) => {
          const downloadLink = document.createElement("a");
          downloadLink.href = URL.createObjectURL(zipBlob);
          downloadLink.download = "graph_files.zip";
          downloadLink.click();
        });
      } catch (error) {
        console.error("Error:", error);
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
            setSelect.has(node.data.id) || 
            !cy.vars['mode'].value.includes(node.data.type)
          );
        });

        setSelect = new Set(paneData.elements.nodes.map(d => d.data.id));

        if (paneData.elements.edges) {
          paneData.elements.edges = paneData.elements.edges.filter(edge => {
            return (
              setSelect.has(edge.data.source) && 
              setSelect.has(edge.data.target)
            );
          });
        }
      }

      const dataStr = 
        "data:text/json;charset=utf-8," + 
        encodeURIComponent(JSON.stringify(paneData));
      const dl = document.getElementById('download');
      dl.setAttribute("href", dataStr);
      dl.setAttribute("download", `graph-${cy.paneId}.json`);
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
      value: "end",
      fn: updateNewPanePosition,
    },
    fullSync: {
      value: true,
      fn: toggleFullSync,
    },
  };

  cy.fns = {
    'import': importCy,
    'export': exportCy,
    'mark': mark,
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
    .filter((id) => !id.includes("t_"));

  const sourcePaneId = cy.container().parentElement.id;

  const panes = getPanes();
  const paneData = panes[sourcePaneId];

  const spawnerNodes = paneData.spawnerNodes;
  const pane = spawnPane(
    {
      // spawner: cy.container().parentElement.id,
      spawner: initSpawner || paneData.spawner,
      id: "DUPLICATE-" + cy.paneId + "-" + Math.random(), // TODO make monotonically increasing instead of random
    },
    nodesIds,
    spawnerNodes
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
    var initSpawnerId = "";
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
  Object.keys(panes).forEach(function (paneId) {
    const paneCy = panes[paneId].cy;
    paneCy.nodes().removeClass("recurring");
  });
}

function markRecurringNodes() {
  const panes = getPanes();
  const duplicates = {};
  Object.keys(panes).forEach(function (paneId) {
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
  Object.keys(duplicates).forEach(function (nodeId) {
    const duplicatePanes = duplicates[nodeId];
    if (duplicatePanes.size > 1) {
      recurringNodes[nodeId] = duplicatePanes;

      const randomColor = getRandomColor();
      duplicatePanes.forEach((paneId) => {
        const paneCy = panes[paneId].cy;
        paneCy.$("#" + nodeId).addClass("recurring");
      });
    }
  });
}

function markRecurringNodesById(markId, showInOverview = false) {
  const panes = getPanes();
  const duplicates = {};
  Object.keys(panes).forEach(function (paneId) {
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
  Object.keys(duplicates).forEach(function (nodeId) {
    const duplicatePanes = duplicates[nodeId];
    if (duplicatePanes.size > 1) {
      recurringNodes[nodeId] = duplicatePanes;
      duplicatePanes.forEach((paneId) => {
        const paneCy = panes[paneId].cy;
        paneCy.$("#" + nodeId).addClass("recurring");
      });
    }
    if (showInOverview) {
      socket.emit("duplicate pane ids", duplicatePanes);
    }
  });
}

function resetPaneNodeMarkings() {
  socket.emit("reset pane-node markings");
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
      .filter((id) => !id.includes("t_"));
    const pane = spawnPane(
      {
        spawner: spawnerIds,
        id: "MERGED-" + spawnerIds.join("-"),
      },
      nodesIds,
      spawnerNodes
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
          group: "nodes",
          data: d.data,
        };
      }),
      edges: data.edges.map((edge) => {
        const d = edge.data;
        return {
          group: "edges",
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
      title: "Merge Panes",
      text: "Do you want to keep the merged panes? ",
      icon: "warning",
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#555",
      confirmButtonText: "Keep merged panes",
      denyButtonText: "Remove merged panes",
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

function handleMarkNodes(e) {
  const targets = cy.$('node:selected');
  if (!targets.classes().includes("marked")) {
    dispatchEvent(events.GLOBAL_MARK(targets.map(t => t.data().id)));
  } else {
    dispatchEvent(events.GLOBAL_UNMARK(targets.map(t => t.data().id)));
  }
  document.activeElement.blur()
}

function initControls(cy) {
  document.getElementById(`${cy.paneId}-expand1`).addEventListener('click', (e) => {
    const modifier = (e.ctrlKey || e.altKey);
    if (modifier) {
      spawnGraphOnNewPane(cy, cy.$('node:selected').map(n => n.data()));
    } else {
      graphExtend(cy, cy.$('node:selected'));
    }
    document.activeElement.blur()
  });
  
  document.getElementById(`${cy.paneId}-expandN`).addEventListener('click', (e) => {
    iteration = 0;
    expandBestPath(cy, cy.$('node.s:selected'));
    document.activeElement.blur()
  });

  document.getElementById(`${cy.paneId}-mark`).addEventListener('click', handleMarkNodes);
}

function ctxmenu(cy) {
  cy.ctxmenu = cy.contextMenus({
    menuItems: [
      // node specific
      {
        id: 'expand',
        content: INTERACTIONS.expand1.name, 
        tooltipText: `${INTERACTIONS.expand1.description} \t (${INTERACTIONS.expand1.keyboard})`,
        selector: 'node.s',
        onClickFunction: () => {
          setPane(cy.paneId);
          hideAllTippies();
          graphExtend(cy, cy.$('node:selected'));
        },
        hasTrailingDivider: false,
      },
      /*{
        id: 'remove',
        content: 'Collapse outgoing',
        tooltipText: 'collapse outgoing',
        selector: 'node.s',
        onClickFunction: (event) => {
          const target = event.target || event.cyTarget;
          console.log('Under development!')
        },
        hasTrailingDivider: false
      },*/
      {
        id: "expand-best-path",
        content: INTERACTIONS.expandN.name,
        tooltipText: `${INTERACTIONS.expandN.description} \t (${INTERACTIONS.expandN.keyboard})`,
        selector: "node.s:selected",
        onClickFunction: () => {
          iteration = 0;
          expandBestPath(cy, cy.$('node.s:selected'));
        },
        hasTrailingDivider: false,
      },
      {
        id: "mark-node",
        content: INTERACTIONS.mark.name,
        tooltipText: `${INTERACTIONS.mark.description} \t (${INTERACTIONS.mark.keyboard})`,
        selector: "node.s",
        onClickFunction: handleMarkNodes,
        hasTrailingDivider: true,
      },
      {
        id: "expand-new",
        content: `${INTERACTIONS.expand1.name} on New Pane`,
        tooltipText: `${INTERACTIONS.expand1.description} \t (${INTERACTIONS.expand1.keyboard_pane})`,
        selector: "node.s:selected",
        onClickFunction: () => {
          const nodes = cy.$("node.s:selected");
          hideAllTippies();
          spawnGraphOnNewPane(cy, nodes.map((n) => n.data()));
        },
        hasTrailingDivider: false,
      },
      {
        id: "mark-recurring-node-pane",
        content: "Mark recurring pane-nodes",
        tooltipText: "Mark pane-nodes that include this node",
        selector: "node:selected",
        onClickFunction: (event) => {
          const target = event.target || event.cyTarget;
          const nodeId = target.data().id;
          markRecurringNodesById(nodeId, true);
        },
        hasTrailingDivider: true,
      },
      {
        id: "inspect-pcp",
        content: "Inspect selection details",
        tooltipText: "inspect selection details",
        selector: "node:selected",
        onClickFunction: function (event) {
          spawnPCP(cy);
        },
        hasTrailingDivider: true,
      },

      // pane controls
      {
        id: "fit-to-pane",
        content: "Fit to view",
        tooltipText: "fit to pane",
        coreAsWell: true,
        onClickFunction: () => cy.fit(),
        hasTrailingDivider: false,
      },
      {
        id: "collapse-pane",
        content: "Collapse/expand pane",
        tooltipText: "collapse/expand pane",
        coreAsWell: true,
        onClickFunction: () => {
          togglePane(
            document.getElementById(
              document.getElementById("selected-pane").innerHTML
            ),
          );
        },
        hasTrailingDivider: true,
      },
      {
        id: "import-pane",
        content: "Import Graph",
        tooltipText: "import graph",
        coreAsWell: true,
        onClickFunction: () => {
          importCy(cy);
        },
        hasTrailingDivider: false,
      },
      {
        id: "export-pane",
        content: "Export Graph",
        tooltipText: "export graph",
        coreAsWell: true,
        onClickFunction: () => {
          exportCy(cy);
        },
        hasTrailingDivider: true,
      },
      {
        id: "duplicate-pane",
        content: "Duplicate pane",
        tooltipText: "dup-pane",
        coreAsWell: true,
        onClickFunction: () => {
          duplicatePane(cy);
        },
        hasTrailingDivider: false,
      },
      {
        id: "destroy-pane",
        content: "Remove pane",
        tooltipText: "remove pane",
        coreAsWell: true,
        onClickFunction: () => {
          if (cy.paneId === "pane-0") {
            Swal.fire({
              icon: "error",
              title: "Oops...",
              text: "Cannot delete initial pane!",
            });
          } else {
            Swal.fire({
              title: "Removing Pane(s)",
              text: "This action cannot be reverted.",
              icon: "warning",
              showCancelButton: true,
              showDenyButton: true,
              confirmButtonColor: "#d33",
              cancelButtonColor: "#555",
              confirmButtonText: "Remove Current",
              denyButtonText: "Remove All From Selected",
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
        id: "reset-pane-node-markings",
        content: "Reset pane-node markings",
        tooltipText: "Reset pane-node markings",
        coreAsWell: true,
        onClickFunction: () => {
          resetPaneNodeMarkings();
        },
        hasTrailingDivider: false,
      }
    ],
    menuItemClasses: ["dropdown-item"],
    contextMenuClasses: ["dropdown-menu"],
    submenuIndicator: {
      src: "/style/icons/submenu.svg",
      width: 12,
      height: 12,
    },
  });
}

function keyboardShortcuts(cy, e) {
  const modifier = (e.ctrlKey || e.altKey);
  cy.nodes().selectify();

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
    if (cy.vars["fullSync"].value) {
      spawnPCP(cy);
    }
  } 

  // ctrl+i: select initial states 
  if (e.keyCode === 73 && modifier) {
    selectBasedOnAP(e, NAMES.ap_init);
  }

  // ctrl+d: select deadlock states 
  if (e.keyCode === 68 && modifier) {
    selectBasedOnAP(e, NAMES.ap_deadlock);
  }

  // ctrl+e: select end states 
  if (e.keyCode === 69 && modifier) {
    selectBasedOnAP(e, NAMES.ap_end);
  }

  // ctrl+m: mark/unmark selected nodes 
  if (e.keyCode === 77 && modifier) {
    handleMarkNodes(e);
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
      const parents = cy.nodes("#" + ids.join(", #"));
      parents.select();
      if (cy.vars["fullSync"].value) {
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
      if (cy.vars["scheduler"].value === "_none_") { 
        // open everything, as there is no decider / DOI / scheduler
        const ids = sources.map(src => getNextInPath(cy, src.data().id).next).flat();
        const nexts = cy.nodes("#" + ids.join(", #"));    
        nexts.select();
      } else { 
        // follow only the "best" path according to DOI/scheduler
        const ids = sources.map(src => getNextBestInPath(cy, src.data().id).bestNext);
        const nextBests = cy.nodes("#" + ids.join(", #"));
        nextBests.select();
      }

      if (cy.vars["fullSync"].value) {
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
      spawnGraphOnNewPane(cy, cy.$('node:selected').map(n => n.data()));
    } else {
      graphExtend(cy, cy.$('node:selected'));
    }
  }
}

socket.on("handle selection", (data) => {
  if (data) {
    switch (data) {
      case "merge":
        handleMergePane();
        break;
      case "delete":
        handleDeletePane();
        break;
      case "duplicate":
        handleDuplicatePane();
        break;
      case "expand":
        handleExpandPane();
        break;
      case "collapse":
        handleCollapsePane();
        break;
      case "export":
        handleExportPane();
        break;
    }
  }
});

socket.on("handle overview nodes selected", (data) => {
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
