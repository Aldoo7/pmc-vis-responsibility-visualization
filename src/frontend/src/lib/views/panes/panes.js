import { v4 as uuidv4 } from 'uuid';
import Swal from 'sweetalert2/dist/sweetalert2.all.min.js';

import { setPane } from '../../utils/controls.js';
import { colorList } from '../../utils/utils.js';
import { CONSTANTS } from '../../utils/names.js';
import makeCtxMenu from './ctx-menu.js';
import { BACKEND } from '../../main/main.js';
import { socket } from '../imports/import-socket.js';

const MIN_FLEX_GROW = 0.005;
const MIN_SIZE = 10;
const panes = {}; // governs the pane-based exploration
const tracker = {}; // keeps track of already seen nodes, marks, etc.

// let width;
let height;
const maxheight = () => height - MIN_SIZE * 2;

socket.on('overview node clicked', (data) => {
  if (data) {
    highlightPaneById(data);
  }
});

socket.on('disconnect', () => {
  location.reload();
});

function uid() {
  return 'id' + uuidv4().replace(/-/g, '');
}

function updateHeights() {
  Object.values(panes).forEach((p) => {
    p.height = height;
    document.getElementById(p.id).style.height = p.height + 'px';
  });
}

function spawnPane({ spawner, id, newPanePosition }, nodesIds, spawnerNodes) {
  const paneKeysBefore = Object.keys(panes);
  const index = paneKeysBefore.length % colorList.length;
  const backgroundColor = colorList[index];
  const pane = {
    id: id || uid(),
    container: uid(),
    dragbar: uid(),
    // width: dims.width,
    height,
    split: 0.3, // defines how much height the pcp has
    cy: undefined, // must be set later!,
    backgroundColor,
    nodesIds: new Set(nodesIds),
    spawner,
    spawnerNodes,
  };

  const newPane = {
    backgroundColor: pane.backgroundColor,
    id: pane.id,
    nodesIds: pane.nodesIds,
    spawner,
    spawnerNodes,
  };

  socket.emit('pane added', newPane);

  pane.details = pane.container + '-details';

  // pane div
  const div = document.createElement('div');
  div.className = 'cy-s flex-item pane';
  div.id = pane.id;
  div.style.flex = paneKeysBefore.length + 1;
  div.style.height = pane.height + 'px';

  // add the node-link diagram view
  const cyContainer = document.createElement('div');
  cyContainer.id = pane.container;
  cyContainer.className = 'cy';
  cyContainer.style.height = pane.height * (1 - pane.split) + 'px';

  const dragbar = document.createElement('div');
  dragbar.id = pane.dragbar;
  dragbar.className = 'dragbar';

  const buttons = createPaneControls(pane);

  // add the pane for the detail view (pcp)
  const details = document.createElement('div');
  details.className = 'detail-inspector';
  details.id = pane.details;
  details.style.height = pane.height * pane.split + 'px';

  const split_dragbar = document.createElement('div');
  split_dragbar.id = pane.dragbar + '-split';
  split_dragbar.className = 'split-dragbar';

  const sd_maximize = document.createElement('button');
  sd_maximize.title = 'Maximize PCP';
  sd_maximize.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
  sd_maximize.className = 'split-button split-max';
  sd_maximize.addEventListener('click', () => {
    if (cyContainer.clientHeight === MIN_SIZE) {
      resizeSplit(cyContainer, panes[div.id]._split);
      sd_maximize.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
      sd_maximize.title = 'Maximize PCP';
    } else {
      resizeSplit(cyContainer, MIN_SIZE);
      sd_maximize.innerHTML = '<i class="fa-solid fa-undo"></i>';
      sd_maximize.title = 'Undo maximize';
    }
  });

  const sd_minimize = document.createElement('button');
  sd_minimize.title = 'Minimize PCP';
  sd_minimize.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
  sd_minimize.className = 'split-button split-min';
  sd_minimize.addEventListener('click', () => {
    const max = Math.round(maxheight());
    if (cyContainer.clientHeight === max) {
      resizeSplit(cyContainer, panes[div.id]._split);
      sd_minimize.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
      sd_minimize.title = 'Minimize PCP';
    } else {
      resizeSplit(cyContainer, max);
      sd_minimize.innerHTML = '<i class="fa-solid fa-undo"></i>';
      sd_minimize.title = 'Undo minimize';
    }
  });

  split_dragbar.appendChild(sd_minimize);
  split_dragbar.appendChild(sd_maximize);

  div.appendChild(buttons);
  div.appendChild(cyContainer);
  div.appendChild(split_dragbar);
  div.appendChild(details);

  if (paneKeysBefore.length > 0) {
    if (
      document.getElementById(spawner)
      && newPanePosition?.value === 'insert'
    ) {
      document.getElementById(spawner).insertAdjacentElement('afterend', div);
      document
        .getElementById(spawner)
        .insertAdjacentElement('afterend', dragbar);
    } else {
      document.getElementById('container')?.appendChild(dragbar);
      document.getElementById('container')?.appendChild(div);
    }
  } else {
    document.getElementById('container')?.appendChild(div);
  }

  panes[div.id] = pane;
  const paneKeysAfter = Object.keys(panes);
  if (spawner && panes[spawner]) {
    if (spawner.length > 0) {
      // TODO, eg merged
    }
    panes[spawner].spawned ||= new Set();
    panes[spawner].spawned.add(div.id); // remembers which panes were created from this one
  }

  enableDragBars();
  const numberOfPanes = document.getElementById('numberOfPanes');

  if (paneKeysAfter.length > numberOfPanes.value) {
    destroyPanes(
      panes[paneKeysAfter[1]].id, // skip the first pane
      {
        firstOnly: true,
        pre: true,
      },
    );
  }

  return pane;
}

function createPaneControls(pane) {
  const buttons = document.createElement('div');
  buttons.className = 'pane-controls';
  buttons.id = `${pane.container}-controls`;
  buttons.style.width = 0;
  buttons.style.width = 0;
  buttons.style.backgroundColor = pane.backgroundColor + '50';

  const setting = document.getElementById('bestPathLength');
  const l = setting ? setting.value : CONSTANTS.INTERACTIONS.expandN.default;

  buttons.innerHTML = `<div class="ui blue bottom attached icon buttons">
        <button class="ui button" id="${pane.id}-expand1"
            title="${CONSTANTS.INTERACTIONS.expand1.name} \t (${CONSTANTS.INTERACTIONS.expand1.keyboard})">
            <i class="${CONSTANTS.INTERACTIONS.expand1.icon}" aria-hidden="true"></i>
        </button>
        <button class="ui button" id="${pane.id}-expandN"
            title="${CONSTANTS.INTERACTIONS.expandN.name(l)} \t (${CONSTANTS.INTERACTIONS.expandN.keyboard})">
            <i class="${CONSTANTS.INTERACTIONS.expandN.icon}" aria-hidden="true"></i>
        </button>
        <button class="ui button" id="${pane.id}-mark"
            title="${CONSTANTS.INTERACTIONS.mark.name} \t (${CONSTANTS.INTERACTIONS.mark.keyboard})">
            <i class="${CONSTANTS.INTERACTIONS.mark.icon}" aria-hidden="true"></i>
        </button>
    </div>`;

  return buttons;
}

function resizePane(div, flexGrow) {
  const _width = Math.max(MIN_FLEX_GROW, flexGrow);
  const _height = div.getBoundingClientRect().height;
  div.style.flexGrow = flexGrow;

  panes[div.id].width = _width;
  panes[div.id].height = _height;
}

function resizeSplit(div, pheight, save = true) {
  const _height = Math.min(maxheight(), Math.max(MIN_SIZE, pheight));

  if (save) {
    panes[div.parentElement.id]._split = div.clientHeight;
  }

  div.style.height = _height + 'px';

  panes[div.parentElement.id].split = 1 - _height / panes[div.parentElement.id].height;
}

function togglePane(div) {
  if (div) {
    const fg = Number(getComputedStyle(div).flexGrow);

    if (fg === MIN_FLEX_GROW) {
      if (panes[div.id]._flexGrowth < MIN_FLEX_GROW * 2) {
        resizePane(div, 1);
      } else {
        resizePane(div, panes[div.id]._flexGrowth);
      }
    } else {
      panes[div.id]._flexGrowth = fg;
      resizePane(div, MIN_FLEX_GROW);
      const keys = Object.keys(panes);
      resizePane(document.getElementById(panes[keys[keys.length - 1]].id), 1);
    }
  }
}

function expandPane(div) {
  if (div) {
    resizePane(div, 1);
  }
}

function collapsePane(div) {
  if (div) {
    if (panes[div.id]) {
      panes[div.id]._flexGrowth = Number(getComputedStyle(div).flexGrow);
    }
    resizePane(div, MIN_FLEX_GROW);
  }
}

function enableDragBars() {
  enablePaneDragBars();
  enableSplitDragBars();
}

// https://stackoverflow.com/questions/28767221/flexbox-resizing
function enablePaneDragBars() {
  const dragbars = Array.from(document.getElementsByClassName('dragbar'));
  let dragging = false;

  dragbars.forEach(d => {
    d.onmousedown = null;
    d.ondblclick = null;
  });

  dragbars.forEach(d => {
    d.onmousedown = (e) => {
      const resizer = e.target;
      // e.button === 0 means left click
      if (e.button > 0 || !resizer.classList.contains('dragbar')) {
        return;
      }

      const parent = resizer.parentNode;
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.display !== 'flex') {
        return;
      }

      const [
        prev,
        next,
        sizeProp,
        posProp,
      ] = [
        resizer.previousElementSibling,
        resizer.nextElementSibling,
        'offsetWidth',
        'pageX',
      ];

      e.preventDefault();

      // Avoid cursor flickering (reset in onMouseUp)
      document.body.style.cursor = getComputedStyle(resizer).cursor;

      let prevSize = prev[sizeProp];
      let nextSize = next[sizeProp];
      const sumSize = prevSize + nextSize;
      const prevGrow = Number(getComputedStyle(prev).flexGrow);
      const nextGrow = Number(getComputedStyle(next).flexGrow);
      const sumGrow = prevGrow + nextGrow;
      let lastPos = e[posProp];
      dragging = true;

      document.onmousemove = (ex) => {
        let pos = ex[posProp];
        const d = pos - lastPos;
        prevSize += d;
        nextSize -= d;
        if (prevSize < 0) {
          nextSize += prevSize;
          pos -= prevSize;
          prevSize = 0;
        }
        if (nextSize < 0) {
          prevSize += nextSize;
          pos += nextSize;
          nextSize = 0;
        }

        const prevGrowNew = sumGrow * (prevSize / sumSize);
        const nextGrowNew = sumGrow * (nextSize / sumSize);

        prev.style.flexGrow = prevGrowNew;
        next.style.flexGrow = nextGrowNew;

        lastPos = pos;
      };

      document.onmouseup = () => {
        document.onmousemove = null;
        document.body.style.removeProperty('cursor');

        dragging &&= false;
      };
    };

    d.ondblclick = (e) => {
      const elementId = e.target ? e.target.id : e.srcElement.id;
      const div = document.getElementById(elementId).previousElementSibling;
      togglePane(div);
    };
  });
}

function enableSplitDragBars() {
  const dragbars = Array.from(document.getElementsByClassName('split-dragbar'));

  dragbars.forEach(d => {
    d.onmousedown = null;
    d.ondblclick = null;
  });

  let dragging = false;
  dragbars.forEach(d => {
    d.onmousedown = (e) => {
      const elementId = e.target ? e.target.id : e.srcElement.id;
      const bar = document.getElementById(elementId);

      // e.button === 0 means left click
      if (e.button > 0 || !bar) {
        return;
      }

      const div = bar.previousElementSibling;
      dragging = panes[div.parentElement.id];
      document.onmousemove = (ex) => {
        resizeSplit(div, ex.y - div.getBoundingClientRect().top + 2, false);
      };

      document.onmouseup = () => {
        document.onmousemove = null;
        dragging &&= false;
      };
    };
    d.ondblclick = null;
    if (d && d.previousElementSibling && d.parentElement) {
      makeCtxMenu(d, d.previousElementSibling); // pane is: panes[d.parentElement.id]
    }
  });
}

function getPanes() {
  return panes;
}

function updatePanes(newPanesData) {
  Object.keys(newPanesData).forEach((k) => (panes[k] = newPanesData[k]));
}

// recursively destroy every pane starting from an id
function destroyPanes(firstId, { firstOnly = false, pre = false } = {}) {
  const pane = document.getElementById(firstId);

  if (pane) {
    if (panes[firstId] && panes[firstId].spawned?.size > 0) {
      if (!firstOnly) {
        panes[firstId].spawned.forEach(p => destroyPanes(p));
      }
    }

    const dragbar = pane.previousElementSibling;
    if (dragbar && dragbar.classList.contains('dragbar')) {
      dragbar.remove();
    }

    pane.remove();
    delete panes[firstId];

    const newKeys = Object.keys(panes);
    newKeys.forEach((k) => {
      panes[k].spawned?.delete(firstId);
    });

    if (!pre) {
      setPane(panes[newKeys[newKeys.length - 1]].id);
    }

    socket.emit('pane removed', firstId);
  }
}

function highlightPaneById(paneId) {
  const paneDiv = document.getElementById(paneId);
  setPane(paneId);
  if (paneDiv) {
    if (panes) {
      Object.keys(panes).forEach((id) => {
        if (id !== paneId) {
          const otherPaneDiv = document.getElementById(id);
          collapsePane(otherPaneDiv);
        }
      });
    }

    expandPane(paneDiv);
  }
}

function updateDocDims() {
  // width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;

  const navHeight = parseInt(
    // turns NNpx into NN
    window.getComputedStyle(document.body).getPropertyValue('--nav-height'),
  );

  height = -navHeight
    + (window.innerHeight
      || document.documentElement.clientHeight
      || document.body.clientHeight);

  // width -= document.getElementById("config")?.clientWidth;
  updateHeights();
}

updateDocDims();

addEventListener('resize', () => {
  updateDocDims();
  Object.keys(panes).forEach((pane) => {
    panes[pane].height = height;
    const container = document.getElementById(panes[pane].id);
    container.style.height = height + 'px';
    document.getElementById(panes[pane].container).style.height = height * (1 - panes[pane].split) + 'px';
    document.getElementById(panes[pane].details).style.height = height * panes[pane].split + 'px';
  });
});

addEventListener('global-action', (e) => {
  if (e.detail.action === 'propagate') {
    Object.keys(tracker).forEach((k) => {
      Object.values(getPanes()).forEach((pane) => {
        pane.cy.fns[k](pane.cy, Array.from(tracker[k]));
      });
    });
  } else {
    const action = e.detail.type + e.detail.action;
    tracker[e.detail.action] ||= new Set();

    if (e.detail.type === '') {
      e.detail.elements.forEach(
        tracker[e.detail.action].add,
        tracker[e.detail.action],
      );
    } else {
      // "undo-"
      e.detail.elements.forEach(
        tracker[e.detail.action].delete,
        tracker[e.detail.action],
      );
    }

    Object.values(getPanes()).forEach((pane) => {
      pane.cy.fns[action](pane.cy, e.detail.elements);
    });
  }
});

document.getElementById('export-strat')?.addEventListener('click', () => {
  if (!tracker['mark']) {
    Swal.fire({
      icon: 'error',
      title: 'Nothing to export',
      html: 'Nodes can be marked/unmarked using CTRL+M, the bookmark button atop the pane, or the context menu (right-click)',
      timer: 5000,
      timerProgressBar: true,
    });
    return;
  }

  const checker = {
    nodes: structuredClone(tracker['mark']),
    edges: new Set(),
    sources: new Set(),
    targets: new Set(),
  };

  const returnable = {
    nodes: new Map(),
    edges: new Map(),
  };

  let paneData;
  Object.values(getPanes()).forEach((pane) => {
    paneData = pane.cy.json();

    if (paneData.elements.edges) {
      paneData.elements.edges.forEach((edge) => {
        if (
          tracker['mark'].has(edge.data.source)
          || tracker['mark'].has(edge.data.target)
        ) {
          checker.edges.add(edge.data.id);

          if (edge.data.source.startsWith('t')) {
            checker.sources.add(edge.data.source);
          }

          if (edge.data.target.startsWith('t')) {
            checker.targets.add(edge.data.target);
          }
        }
      });

      paneData.elements.edges.forEach((edge) => {
        if (checker.edges.has(edge.data.id)) {
          if (edge.data.source.startsWith('t')) {
            if (checker.targets.has(edge.data.target)) {
              returnable.edges.set(edge.data.id, edge);
            } else {
              checker.sources.delete(edge.data.source);
            }
          }

          if (edge.data.target.startsWith('t')) {
            if (checker.sources.has(edge.data.target)) {
              returnable.edges.set(edge.data.id, edge);
            } else {
              checker.targets.delete(edge.data.source);
            }
          }
        }
      });
    }

    paneData.elements.nodes.forEach((node) => {
      if (
        checker.nodes.has(node.data.id)
        || (node.data.type === 't'
          && checker.sources.has(node.data.id)
          && checker.targets.has(node.data.id))
      ) {
        checker.nodes.add(node);
        returnable.nodes.set(node.data.id, node);
      }
    });
  });

  paneData.elements.nodes = Array.from(returnable.nodes.values());
  paneData.elements.edges = Array.from(returnable.edges.values());

  const dataStr = 'data:text/json;charset=utf-8,'
    + encodeURIComponent(JSON.stringify(paneData));
  const dl = document.getElementById('download');
  dl.setAttribute('href', dataStr);
  dl.setAttribute('download', 'strategy-export.json');
  dl.click();
});

document
  .getElementById('new-project')
  ?.addEventListener('click', async () => {
    let redirectName;
    await Swal.fire({
      title: 'Create new project',
      html: `
        
        <div>
            <p> If creation is successful, you will be redirected. </p>
    
            <label style="float:left;margin-bottom:10px" for="prism-model">Choose a model file:</label>
    
            <div class="ui file input">
                <input id="prism-model" type="file" accept=".prism, .mdp, .pm">
            </div>
    
            <div class="ui divider"></div>
    
            <label style="float:left;margin-bottom:10px;margin-top:15px" for="prism-props">Choose a properties file:</label>
    
            <div class="ui file input">
                <input id="prism-props" type="file" accept=".props">
            </div>
    
            <div class="ui divider"></div>
    
            <label style="float:left;margin-bottom:10px;margin-top:15px;margin-right:50px">Project name (optional):</label>
    
            <div style="float:left;" class="ui input">
                <input id="project-name" type="text" placeholder="Project name">
            </div>
        </div>`,
      focusConfirm: false,
      confirmButtonText: 'Create',
      confirmButtonColor: 'green',

      preConfirm: () => {
        Swal.showLoading();
        const modelInput = document.getElementById('prism-model');
        const propsInput = document.getElementById('prism-props');
        const nameInput = document.getElementById('project-name');
        if (modelInput.value && propsInput.value) {
          const formValues = {
            model: [modelInput.value, modelInput.files[0]],
            props: [propsInput.value, propsInput.files[0]],
            name: nameInput.value,
          };

          const formData = new FormData();

          formData.append(
            'model_file',
            formValues.model[1],
            formValues.model[0],
          );
          formData.append(
            'property_file',
            formValues.props[1],
            formValues.props[0],
          );

          formValues.name ||= uuidv4();
          redirectName = formValues.name;
          return fetch(
            `${BACKEND}/${formValues.name}/create-project`,
            {
              method: 'POST',
              body: formData,
            },
          );
        }
      },
    }).then((response) => {
      if (response.value) {
        if (response.value.status === 200) {
          Swal.fire({
            title: 'Success!',
            html: 'Redirecting to the created project on a new tab. ',
            timer: 2000,
            timerProgressBar: true,
          }).then(() => {
            window
              .open(
                window.location.href.split('?')[0] + '?id=' + redirectName,
                '_blank',
              )
              .focus();
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error Creating New Project',
            text: `Something went wrong! Received status ${response.status}. Please see the logs for more details`,
          });
        }
      }
    });
  });

export {
  enablePaneDragBars,
  spawnPane,
  getPanes,
  updatePanes,
  destroyPanes,
  togglePane,
  expandPane,
  collapsePane,
  resizeSplit,
  highlightPaneById,
  uid,
};
