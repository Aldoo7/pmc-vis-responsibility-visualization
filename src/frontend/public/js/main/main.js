import { spawnPane, info, getPanes } from "../views/panes/panes.js";
import { params } from "../views/node-link/layout-options/elk.js";
import { spawnGraph } from "../views/node-link/node-link.js";
import { PROJECT } from "../utils/controls.js";
import events from "../utils/events.js";

window.onresize = () => {
  dispatchEvent(events.RESIZE_ALL);
};

const ww = window.innerWidth;
if (ww) {
  document.getElementById('numberOfPanes').value = Math.floor(ww / 200); 
}

Promise.all([
  fetch("http://localhost:8080/" + PROJECT + "/initial").then(r => r.json()),
  //fetch('http://localhost:8080/'+ PROJECT).then((res) => res.json()) // requests entire dataset
]).then((promises) => {
  const data = promises[0];
  Object.keys(data.nodes[0].details).forEach((k) => {
    if (data.info[k]) {
      info[k] = data.info[k];
      delete data.info[k];
    }
  });
  const nodesIds = data.nodes
    .map((node) => node.id)
    .filter((id) => !id.includes("t_"));

  info.metadata = data.info;
  info.metadata.initial = "#" + nodesIds.join(', #');
  delete data.info;

  if (document.getElementById("project-id")) {
    document.getElementById("project-id").innerHTML = info.metadata["ID"];
  }

  const firstPaneId = "pane-0";
  const pane = spawnPane(
    { id: firstPaneId },
    nodesIds
  );

  spawnGraph(pane, data, params);
});

addEventListener('linked-selection', function (e) {
  const selection = e.detail.selection;
  const panes = getPanes();
  panes[e.detail.pane].cy.nodes().unselect();
  const strSelection = '#' + selection.map(n => n.id).join(', #');
  
  if (strSelection !== '#') {
    panes[e.detail.pane].cy.$(strSelection).select();
  }
}, true);
