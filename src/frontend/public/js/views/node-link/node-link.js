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
} from "../panes.js";
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
import NAMES from "../../utils/names.js";

const socket = io();
let selectedPanesData = {
  selectedPanes: [],
  paneCy: null,
};

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
    .filter((n) => {
      return n.data().type === "s";
    })
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
function graphExtend(cy, node) {
  const g = node.data();

  Promise.all([
    fetch("http://localhost:8080/" + PROJECT + "/outgoing?id=" + g.id).then(
      (res) => res.json()
    ),
  ]).then((promises) => {
    const data = promises[0];

    const elements = {
      nodes: data.nodes
        .map((d) => {
          return {
            group: "nodes",
            data: d,
            //position: node.position() // WARNING: setting this prop makes nodes immutable, possible bug with cytoscape
          };
        })
        .filter((d) => {
          const accept = !cy.elementMapper.nodes.has(d.data.id);
          if (accept) {
            cy.elementMapper.nodes.set(d.data.id, d);
          }
          return accept;
        }),
      edges: data.edges
        .map((d) => {
          return {
            group: "edges",
            data: {
              id: d.id,
              label: d.label,
              source: d.source,
              target: d.target,
            },
          };
        })
        .filter((d) => {
          const accept = !cy.elementMapper.edges.has(getEdgeId(d));
          if (accept) {
            cy.elementMapper.edges.set(getEdgeId(d), d);
          }
          return accept;
        }),
    };

    cy.nodes().lock();
    cy.add(elements);
    cy.$("#" + elements.nodes.map((n) => n.data.id).join(", #")).position(
      node.position()
    ); // alternatively, cy.nodes().position(node.position())
    cy.nodes().unlock();

    cy.layout(cy.params).run();
    bindListeners(cy);
    setStyles(cy);
    initHTML(cy);

    const nodesIds = data.nodes
      .map((node) => node.id)
      .filter((id) => !id.includes("t_"));

    const panes = getPanes();
    const paneNodeIds = (
      panes[cy.paneId].nodesIds || []
    ).concat(nodesIds);
    panes[cy.paneId].nodesIds = paneNodeIds;
    updatePanes(panes);
  });
}

// inits cy with graph data on a pane
function spawnGraph(pane, data, params, vars = {}, src) {
  const elements = {
    nodes: data.nodes.map((d) => {
      return { data: d.data ? d.data : d };
    }),
    edges: data.edges.map((d) => {
      return { data: d.data ? d.data : d };
    }),
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
      .map((d) => {
        return { data: d.data() };
      });

    setElementMapper(cy, {
      nodes: nodes,
      edges: cy
        .elements()
        .edges()
        .map((d) => {
          return { data: d.data() };
        }),
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

    initHTML(cy);
    spawnPCP(
      cy,
      cy.nodes().map((n) => n.data())
    );
    dispatchEvent(
      new CustomEvent("global-action", {
        detail: {
          action: "propagate",
        },
      })
    );

    return cy;
  }
  return null;
}

function initHTML(cy) {
  const nodesHTML = document.getElementsByClassName(
    `cy-html cy-html-${cy.paneId}`
  );

  // the html layer lives here, remove it before creating a new one
  if (
    nodesHTML[0] &&
    nodesHTML[0].parentNode &&
    nodesHTML[0].parentNode.parentNode
  ) {
    nodesHTML[0].parentNode.parentNode.remove();
  }

  cy.nodeHtmlLabel([
    
  ]);
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

function fetchAndSpawn(cy, nodes) {
  Promise.all([
    fetch(
      "http://localhost:8080/" +
        PROJECT +
        "/outgoing?id=" +
        nodes.map((n) => n.id).join("&id=")
    ).then((res) => res.json()),
  ]).then((promises) => {
    const data = promises[0];

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
  });
}

// interactions
function ctxmenu(cy) {
  cy.ctxmenu = cy.contextMenus({
    menuItems: [
      // node specific
      {
        id: 'expand',
        content: 'Expand Once',
        tooltipText: 'expand outgoing',
        selector: 'node.s',
        onClickFunction: function (event) {
          const target = event.target || event.cyTarget;
          setPane(cy.paneId);
          hideAllTippies();
          graphExtend(cy, target);
        },
        hasTrailingDivider: false,
      },
      /*{
        id: 'remove',
        content: 'Collapse outgoing',
        tooltipText: 'collapse outgoing',
        selector: 'node.s',
        onClickFunction: function (event) {
          const target = event.target || event.cyTarget;
          console.log('Under development!')
        },
        hasTrailingDivider: false
      },*/
      {
        id: "expand-best-path",
        content: "Expand N (Simulation)",
        tooltipText: "Expand node to specified iterations",
        selector: "node:selected",
        onClickFunction: function (event) {
          const target = event.target || event.cyTarget;
          iteration = 0;
          expandBestPath(cy, target);
        },
        hasTrailingDivider: false,
      },
      {
        id: "color",
        content: "Mark/unmark node",
        tooltipText: "mark node",
        selector: "node.s",
        onClickFunction: function (event) {
          const target = event.target || event.cyTarget;

          if (!target.classes().includes("marked")) {
            dispatchEvent(
              new CustomEvent("global-action", {
                detail: {
                  action: "mark",
                  type: "",
                  elements: [target.data().id],
                },
              })
            );
          } else {
            dispatchEvent(
              new CustomEvent("global-action", {
                detail: {
                  action: "mark",
                  type: "undo-",
                  elements: [target.data().id],
                },
              })
            );
          }
        },
        hasTrailingDivider: true,
      },
      {
        id: "commit",
        content: "Explore in new pane",
        tooltipText: "explore in new pane",
        selector: "node.s:selected",
        onClickFunction: function (event) {
          //const target = event.target || event.cyTarget; // gives the selected node
          const nodes = cy.$("node.s:selected");
          //setPane(cy.paneId);
          hideAllTippies();
          spawnGraphOnNewPane(
            cy,
            nodes.map((n) => n.data())
          );
        },
        hasTrailingDivider: false,
      },
      {
        id: "mark-recurring-node-pane",
        content: "Mark pane-nodes",
        tooltipText: "Mark pane-nodes that include this node",
        selector: "node:selected",
        onClickFunction: function (event) {
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
            )
          );
        },
        hasTrailingDivider: true,
      },
      {
        id: "import-pane",
        content: "Import Graph",
        tooltipText: "import graph",
        selector: "node, edge",
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
        selector: "node, edge",
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
var iteration = 0;
var maxIteration = 5;

const setMaxIteration = (value) => {
  maxIteration = value;
};
function expandBestPath(cy, target) {
  const isTargetEnd = 
    target.data()?.details[NAMES.atomicPropositions]?.end?.value;

  if (cy.vars["scheduler"].value === "_none_") {
    Swal.fire({
      position: "top-end",
      icon: "error",
      title: "No scheduler selected!",
      timer: 1500,
      timerProgressBar: true,
    });
  } else {
    var sourceNodeId = target.data().id;
    graphExtend(cy, target);

    var nextCy = cy;
    var nextTarget = target;

    getNextBestPath(cy, sourceNodeId).then((res) => {
      iteration++;
      nextCy = res.cy;
      nextTarget = res?.nodeToExpand;
      sourceNodeId = nextTarget?.data?.id;

      var selectedCyNode = cy.nodes("#" + sourceNodeId);
      if (maxIteration > 0) {
        if (
          iteration < maxIteration &&
          nextCy &&
          selectedCyNode &&
          !isTargetEnd
        ) {
          expandBestPath(nextCy, selectedCyNode);
        }
      } else {
        if (nextCy && selectedCyNode && !isTargetEnd) {
          expandBestPath(nextCy, selectedCyNode);
        }
      }
    });
  }
}

async function getNextBestPath(cy, sourceNodeId) {
  return new Promise((resolve) => {
    setTimeout(() => {
      var bestValue = 0;
      var bestNodeToExpand = "";
      var tId = "";

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
              bestNodeToExpand = target;
              tId = target;
            }
          }
        }
      });

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
              bestNodeToExpand = target;
              tId = source;
            }
          }
        }
      });
      const nodeToExpand = cy.elementMapper.nodes.get(bestNodeToExpand);
      var res = { cy: cy, nodeToExpand: nodeToExpand };

      resolve(res);
    }, "500");
  });
}

function resetPaneNodeMarkings() {
  socket.emit("reset pane-node markings");
}

function lockCy(cy) {
  cy.nodes().lock();
  cy.panningEnabled(false);
  cy.zoomingEnabled(false);
  unbindListeners(cy);

  cy.on("tap", function (e) {
    setPane(cy.paneId);
  });

  cy.on("grabon", function (e) {
    setPane(cy.paneId);
  });

  cy.on("cxttapstart", function (e) {
    setPane(cy.paneId);
    console.log("right click lane");
  });
}

function unlockCy(cy) {
  cy.nodes().unlock();
  cy.panningEnabled(true);
  cy.zoomingEnabled(true);
  bindListeners(cy);
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

  //lockCy(cy);
  //cy.container().childNodes.forEach(c => c.style.visibility = 'hidden');

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

  //unlockCy(cy);

  cy.paneFromPCP = (pane) => {
    spawnGraphOnNewPane(pane.cy, pane.cy.pcp.getSelection());
  };
}

function unbindListeners(cy) {
  // clean listeners
  cy.off('tap');
  cy.off('cxttapstart');
  cy.off('grabon');
  cy.off('tap', 'edge');
  cy.off('zoom pan');
  cy.nodes().forEach(function (n) {
    n.off('click');
    n.off('dblclick');
  });
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

  cy.on("boxselect tapselect tapunselect", function (e) {
    // automatically syncs node selection to the PCP
    const nodes = cy.$('node:selected');
    if (
      nodes.length > 0 // needed for tapunselect
      && cy.vars["fullSync"].value
    ) { 
      spawnPCP(cy);
    }
  });

  // ensure that selections don't go away when clicking the background once
  cy.on('click', (e) => {
    if (e.target === cy) { // background
      cy.nodes().unselectify();
    } else {
      cy.nodes().selectify();
    }
  });

  // re-enable selections after the previous check happened
  cy.on('dblclick mousemove', _ => {
    cy.nodes().selectify();
  });

  cy.on('select boxselect', 'node.s', function (event) {
    handleEditorSelection(event, cy);
  });

  cy.nodes().forEach(function (n) {
    n.on('click', function (e) {
      setPane(cy.paneId);

      if (!e.originalEvent.shiftKey) {
        hideAllTippies();
      }

      if (e.originalEvent.shiftKey) {
        let g = n.data();

        const $links = [];

        const details = cy.vars['details'].value;
        Object.keys(details).forEach(d => {
          const show = 
            details[d].all || 
            Object.values(details[d].props).reduce((a, b) => a || b);

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

    n.on('dblclick', function (e) {
      hideAllTippies();
      
      if (
        e.originalEvent.altKey && 
        n.classes().filter(c => c === 's').length > 0
      ) {
        spawnGraphOnNewPane(cy, [n.data()]);
      } else {
        graphExtend(cy, n);
      }
    });
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
    cy.style()
      .selector('core')
      .css({ "selection-box-color": colors.SELECTED_NODE_COLOR });

    cy.style().selector('node.t:selected').css({
      'opacity': '0.5',
      'border-color': colors.SECONDARY_NODE_COLOR,
    })

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
  const details = cy.elements()[0].data().details;

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
  cy.vars["panePosition"].value = prop;
}

function toggleFullSync(cy, prop) {
  console.log(cy.vars)
  cy.vars["fullSync"].value = prop;
}

function keyboardShortcuts(cy, e) {
  if (e.keyCode === 90 && e.ctrlKey) { // ctrl+z
    cy.vars['ur'].value.undo(); 
  } else if (e.keyCode === 89 && e.ctrlKey) { // ctrl+y
    cy.vars['ur'].value.redo(); 
  } else if (e.keyCode === 65 && e.ctrlKey) { // ctrl+a
    e.preventDefault(); 
    cy.nodes().select();
    if (cy.vars["fullSync"].value) {
      spawnPCP(cy);
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
          dispatchEvent(
            new CustomEvent("global-action", {
              detail: {
                action: 'propagate',
              },
            })
          );
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

// download JSON files as a zip
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
      fn: keyboardShortcuts,
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

// duplicate multiple panes, considering the paths of the duplicates
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
  var duplicates = {};
  Object.keys(panes).forEach(function (paneId) {
    const nodesIds = panes[paneId].nodesIds;
    nodesIds.forEach((nodeId) => {
      if (duplicates[nodeId] && !duplicates[nodeId].includes(paneId)) {
        duplicates[nodeId] = duplicates[nodeId].concat(paneId);
      } else {
        duplicates[nodeId] = [paneId];
      }
    });
  });

  const recurringNodes = {};
  Object.keys(duplicates).forEach(function (nodeId) {
    const duplicatePanes = duplicates[nodeId];
    if (duplicatePanes.length > 1) {
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
  var duplicates = {};
  Object.keys(panes).forEach(function (paneId) {
    const nodesIds = panes[paneId].nodesIds;
    nodesIds.forEach((nodeId) => {
      if (markId === nodeId) {
        if (duplicates[nodeId] && !duplicates[nodeId].includes(paneId)) {
          duplicates[nodeId] = duplicates[nodeId].concat(paneId);
        } else {
          duplicates[nodeId] = [paneId];
        }
      }
    });
  });

  var recurringNodes = {};
  Object.keys(duplicates).forEach(function (nodeId) {
    const duplicatePanes = duplicates[nodeId];
    if (duplicatePanes.length > 1) {
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

export {
  spawnGraph,
  markRecurringNodes,
  unmarkRecurringNodes,
  setMaxIteration,
  mergePane,
  handleMergePane,
};
