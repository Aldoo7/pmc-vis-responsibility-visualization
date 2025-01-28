import { setPane } from "../utils/controls.js";
import { colorList } from "../utils/utils.js";

const MIN_LANE_SIZE = 10;
const socket = io();

const panes = {}; // governs the pane-based exploration
const info = {}; // global object  
const tracker = {}; // keeps track of already seen nodes, marks, etc. 
let width;
let height;

socket.on("handle overview node clicked", (data) => {
    if (data) {
        highlightPaneById(data);
    }
});

socket.on("disconnect", () => {
    location.reload();
});

function uid() {
    return "id" + uuidv4().replace(/-/g, "");
}

function updateHeights() {
    Object.values(panes).forEach((p) => {
        p.height = height;
        document.getElementById(p.id).style.height = p.height + "px";
    });
}

function spawnPane(
    { spawner, id, newPanePosition },
    nodesIds,
    spawnerNodes
  ) {
    // if (spawner && panes[spawner] && panes[spawner].spawned) {
    //     destroyPanes(panes[spawner].spawned);
    // }
  
    const dims = calcPaneDims();
    const panesLength = Object.keys(panes).length;
    const index = panesLength % colorList.length;
    const backgroundColor = colorList[index];
    const pane = {
        id: id || uid(),
        container: uid(),
        dragbar: uid(),
        width: dims.width,
        height: dims.height,
        split: dims.split || 0.3,
        cy: undefined, // must be set later!,
        backgroundColor,
        nodesIds,
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

    socket.emit("pane added", newPane);

    pane.details = pane.container + "-details";

    // add the node-link diagram view
    const cyContainer = document.createElement("div");
    cyContainer.id = pane.container;
    cyContainer.className = "cy";
    cyContainer.style.height = dims.height * (1 - pane.split) + "px";

    cyContainer.style.borderBottomColor = backgroundColor + "50";
    cyContainer.style.borderBottomWidth = "25px";
    cyContainer.style.borderBottomStyle = "solid";

    const dragbar = document.createElement("div");
    dragbar.id = pane.dragbar;
    dragbar.className = "dragbar";

    // add the pane for the detail view (pcp)
    const details = document.createElement("div");
    details.className = "detail-inspector";
    details.id = pane.details;
    details.style.width = "100%";
    details.style.height = dims.height * pane.split + "px";

    const split_dragbar = document.createElement("div");
    split_dragbar.id = pane.dragbar + "-split";
    split_dragbar.className = "split-dragbar";

    const div = document.createElement("div");
    div.className = "cy-s";
    div.id = pane.id;
    div.style.width = dims.width + "px";
    div.style.height = dims.height + "px";
    div.appendChild(cyContainer);
    div.appendChild(split_dragbar);
    div.appendChild(details);
    div.appendChild(dragbar);

    if (document.getElementById(spawner) && newPanePosition?.value === "insert") {
        document.getElementById(spawner).insertAdjacentElement("afterend", div);
    } else {
        document.getElementById("container")?.appendChild(div);
    }

    enableDragBars();

    panes[div.id] = pane;
    if (spawner && panes[spawner]) {
        if (spawner.length > 0) {
            // TODO, eg merged
        }
        panes[spawner].spawned = div.id; // to remember which pane was created from this one
    }

    return pane;
}

function calcPaneDims() {
    let paneHeight, paneWidth;
    const paneAmount = Object.keys(panes).length;

    paneHeight = height; // for now, always use all height (lane)
    paneWidth = width;

    if (paneAmount >= 3) {
        paneWidth = width/3;
    } else if (paneAmount !== 0) {
        paneWidth = width/paneAmount;
    } 

    return { height: paneHeight, width: paneWidth };
}

function resizePane(div, pwidth) {
    const _width = Math.max(MIN_LANE_SIZE, pwidth);
    const _height = div.getBoundingClientRect().height;
    div.style.width = _width + "px";

    panes[div.id].width = _width;
    panes[div.id].height = _height;
}

function resizeSplit(div, pheight) {
    const _height = Math.min(
        height - height * 0.05,
        Math.max(MIN_LANE_SIZE, pheight)
    );
    div.style.height = _height + "px";
    panes[div.parentElement.id].split =
        1 - _height / panes[div.parentElement.id].height;
}

function togglePane(div) {
    if (div) {
        if (div.style.width === MIN_LANE_SIZE + "px") {
            // pane is closed
            resizePane(div, panes[div.id].oldWidth);
        } else {
            panes[div.id].oldWidth = div.offsetWidth;
            resizePane(div, MIN_LANE_SIZE);
        }

        dispatchEvent(
            new CustomEvent("paneResize", {
                detail: {
                    pane: panes[div.id],
                },
            })
        );

        refreshCys();
    }
}

function expandPane(div) {
    const windWidth = window.innerWidth;
    if (div) {
        resizePane(div, windWidth / 1.5);

        dispatchEvent(
            new CustomEvent("paneResize", {
                detail: {
                    pane: panes[div.id],
                },
            })
        );

        refreshCys();
    }
}

function collapsePane(div) {
    if (div) {
        if (panes[div.id]) {
            panes[div.id].oldWidth = div.offsetWidth;
        } else {
        }
        resizePane(div, MIN_LANE_SIZE);

        dispatchEvent(
            new CustomEvent("paneResize", {
                detail: {
                    pane: panes[div.id],
                },
            })
        );

        refreshCys();
    }
}

function refreshCys() {
    Object.values(panes).forEach((pane) => {
        // The last spawned cy, for some reason, is not reachable like this. 
        if (pane.cy) {
            pane.cy.resize();
        }
    });
    // force update of the last cy
    if (window.cy) {
        window.cy.resize();
    }
}

function enableDragBars() {
    enablePaneDragBars();
    enableSplitDragBars();
}

function enablePaneDragBars() {
    const dragbars = document.getElementsByClassName("dragbar");

    for (const d of dragbars) {
        d.onmousedown = null;
        d.ondblclick = null;
    }

    let dragging = false;
    for (const d of dragbars) {
        d.onmousedown = function (e) {
            const elementId = e.target ? e.target.id : e.srcElement.id;
            const div = document.getElementById(elementId).parentElement;
            dragging = panes[div.id];
            document.onmousemove = function (ex) {
                resizePane(div, ex.x - div.getBoundingClientRect().left + 2);
            };

            document.onmouseup = function (e) {
                document.onmousemove = null;
                if (dragging) {
                    // resize vis inside pane
                    dispatchEvent(
                        new CustomEvent("paneResize", {
                            detail: {
                                pane: dragging,
                            },
                        })
                    );
                    dragging = false;
                }
                refreshCys();
            };
        };
        d.ondblclick = function (e) {
            const elementId = e.target ? e.target.id : e.srcElement.id;
            const div = document.getElementById(elementId).parentElement;
            togglePane(div);
        };
    }
}

function enableSplitDragBars() {
    const dragbars = document.getElementsByClassName("split-dragbar");

    for (const d of dragbars) {
        d.onmousedown = null;
        d.ondblclick = null;
    }

    let dragging = false;
    for (const d of dragbars) {
        d.onmousedown = function (e) {
            const elementId = e.target ? e.target.id : e.srcElement.id;
            const div = document.getElementById(elementId).previousElementSibling;
            dragging = panes[div.parentElement.id];
            document.onmousemove = function (ex) {
                resizeSplit(div, ex.y - div.getBoundingClientRect().top + 2);
            };

            document.onmouseup = function (e) {
                document.onmousemove = null;
                if (dragging) {
                    // resize vis inside pane
                    dispatchEvent(
                        new CustomEvent("paneResize", {
                            detail: {
                                pane: dragging,
                            },
                        })
                    );
                    dragging = false;
                }
                refreshCys();
            };
        };
        d.ondblclick = null;
    }
}

function getPanes() {
    return panes;
}

function updatePanes(newPanesData) {
    Object.keys(newPanesData).forEach(k => panes[k] = newPanesData[k]);
}

// recursively destroy every pane starting from an id
function destroyPanes(firstId, firstOnly = false) {
    const pane = document.getElementById(firstId);

    if (pane) {
        if (panes[firstId] && panes[firstId].spawned) {
            if (!firstOnly) {
                destroyPanes(panes[firstId].spawned);
            }
        }

        pane.remove();
        delete panes[firstId];
        Object.keys(panes).forEach((k) => {
            if (panes[k].spawned === firstId) {
                panes[k].spawned = undefined;
            }
        });

        socket.emit("pane removed", firstId);
    }
}

function highlightPaneById(paneId) {
    const paneDiv = document.getElementById(paneId);
    setPane(paneId);
    if (paneDiv) {
        expandPane(paneDiv);
        // resizePane(paneDiv, windWidth / 1.5);
        dispatchEvent(
            new CustomEvent("paneResize", {
                detail: {
                    pane: panes[paneDiv.id],
                },
            })
        );
        if (panes) {
            Object.keys(panes).forEach((id) => {
                if (id !== paneId) {
                    const otherPaneDiv = document.getElementById(id);
                    // resizePane(otherPaneDiv, 20);
                    collapsePane(otherPaneDiv);
                }
            });
        }

        // refreshCys();
    }
}

function updateDocDims() {
    width =
        window.innerWidth ||
        document.documentElement.clientWidth ||
        document.body.clientWidth;

    height = -45 + (
        window.innerHeight ||
        document.documentElement.clientHeight ||
        document.body.clientHeight);

    width -= document.getElementById("config")?.clientWidth;
    updateHeights();
}

updateDocDims();

addEventListener("resize", (event) => {
    updateDocDims();
    Object.keys(panes).forEach((pane) => {
        panes[pane].height = height;
        const container = document.getElementById(panes[pane].id);
        container.style.height = height + "px";
        document.getElementById(panes[pane].container).style.height =
            height * (1 - panes[pane].split) + "px";
        document.getElementById(panes[pane].details).style.height =
            height * panes[pane].split + "px";
    });
});

addEventListener("global-action", function (e) {
    if (e.detail.action === "propagate") {
        Object.keys(tracker).forEach((k) => {
            Object.values(getPanes()).forEach((pane) => {
                pane.cy.fns[k](pane.cy, Array.from(tracker[k]));
            });
        });
    } else {
        const action = e.detail.type + e.detail.action;
        if (!tracker[e.detail.action]) {
            tracker[e.detail.action] = new Set();
        }

        if (e.detail.type === "") {
            e.detail.elements.forEach(
                tracker[e.detail.action].add,
                tracker[e.detail.action]
            );
        } else {
            // 'undo-'
            e.detail.elements.forEach(
                tracker[e.detail.action].delete,
                tracker[e.detail.action]
            );
        }

        Object.values(getPanes()).forEach((pane) => {
            pane.cy.fns[action](pane.cy, e.detail.elements);
        });
    }
});

document.getElementById("export-strat")?.addEventListener("click", function () {
    if (!tracker["mark"]) {
        Swal.fire({
            icon: "error",
            title: "Nothing to export",
            html: "Nodes can be marked/unmarked using the context menu (right-click)",
            timer: 5000,
            timerProgressBar: true,
        });
        return;
    }

    const checker = {
        nodes: structuredClone(tracker["mark"]),
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
                    tracker["mark"].has(edge.data.source) ||
                    tracker["mark"].has(edge.data.target)
                ) {
                    checker.edges.add(edge.data.id);

                    if (edge.data.source.startsWith("t_")) {
                        checker.sources.add(edge.data.source);
                    }

                    if (edge.data.target.startsWith("t_")) {
                        checker.targets.add(edge.data.target);
                    }
                }
            });

            paneData.elements.edges.forEach((edge) => {
                if (checker.edges.has(edge.data.id)) {
                    if (edge.data.source.startsWith("t_")) {
                        if (checker.targets.has(edge.data.target)) {
                            returnable.edges.set(edge.data.id, edge);
                        } else {
                            checker.sources.delete(edge.data.source);
                        }
                    }

                    if (edge.data.target.startsWith("t_")) {
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
                checker.nodes.has(node.data.id) ||
                (node.data.type === "t" &&
                    checker.sources.has(node.data.id) &&
                    checker.targets.has(node.data.id))
            ) {
                checker.nodes.add(node);
                returnable.nodes.set(node.data.id, node);
            }
        });
    });

    paneData.elements.nodes = Array.from(returnable.nodes.values());
    paneData.elements.edges = Array.from(returnable.edges.values());

    const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(paneData));
    const dl = document.getElementById("download");
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `strategy-export.json`);
    dl.click();
});

document
    .getElementById("new-project")
    ?.addEventListener("click", async function () {
        let redirectName;
        await Swal.fire({
            title: "Create new project",
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
            confirmButtonText: "Create",
            confirmButtonColor: "green",

            preConfirm: () => {
                Swal.showLoading();
                const modelInput = document.getElementById("prism-model");
                const propsInput = document.getElementById("prism-props");
                const nameInput = document.getElementById("project-name");
                if (modelInput.value && propsInput.value) {
                    const formValues = {
                        model: [modelInput.value, modelInput.files[0]],
                        props: [propsInput.value, propsInput.files[0]],
                        name: nameInput.value,
                    };

                    const formData = new FormData();

                    formData.append(
                        "model_file",
                        formValues.model[1],
                        formValues.model[0]
                    );
                    formData.append(
                        "property_file",
                        formValues.props[1],
                        formValues.props[0]
                    );

                    if (!formValues.name) {
                        formValues.name = uuidv4();
                    }
                    redirectName = formValues.name;
                    return fetch(
                        `http://localhost:8080/${formValues.name}/create-project`,
                        {
                            method: "POST",
                            body: formData,
                        }
                    );
                }
            },
        }).then((response) => {
            if (response.value) {
                if (response.value.status === 200) {
                    Swal.fire({
                        title: "Success!",
                        html: "Redirecting to the created project on a new tab. ",
                        timer: 2000,
                        timerProgressBar: true,
                    }).then(() => {
                        window
                            .open(
                                window.location.href.split("?")[0] + "?id=" + redirectName,
                                "_blank"
                            )
                            .focus();
                    });
                } else {
                    Swal.fire({
                        icon: "error",
                        title: "Error Creating New Project",
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
    highlightPaneById,
    uid,
    info,
};
