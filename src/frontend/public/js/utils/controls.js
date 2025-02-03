import { getPanes, info } from "../views/panes.js";
import { h, t } from "./utils.js";

import { params as _elk } from "../views/node-link/layout-options/elk.js";
import { params as _dagre } from "../views/node-link/layout-options/dagre.js";
import { params as _klay } from "../views/node-link/layout-options/klay.js";
import { params as _cola } from "../views/node-link/layout-options/cola.js";
import NAMES from "./names.js";
import {
  markRecurringNodes,
  setMaxIteration,
  unmarkRecurringNodes,
} from "../views/node-link/node-link.js";

const socket = io();

const $ = document.querySelector.bind(document);
const $cy_config = $("#cy-config");
const $graph_config = $("#graph-config");
const $pcp_config = $("#pcp-config");
const $props_config = $("#props-config");
const $merge_config = $("#merge-config");
const $overview_config = $("#overview-config");

const url = new URL(window.location.href);
const params = new URLSearchParams(url.search);
const PROJECT = params.get("id") || 0;

let pane = null;
let tippies = {};

const layoutTemplates = {
  cola: { value: "cola", name: "Cola", data: _cola },
  klay: { value: "klay", name: "Klay", data: _klay },
  dagre: { value: "dagre", name: "Dagre", data: _dagre },
  elk: { value: "elk", name: "ELK", data: _elk },
};

// updates all graphs active canvas space when a pane resize happens
$("#config-toggle")?.addEventListener("click", function () {
  $("body").classList.toggle("config-closed");
  $("#config-toggle").classList.toggle("icon-inactive");
  if (pane && pane.cy) {
    pane.cy.resize();
  }
});

// panes and settings rely heavily on this function to work
// this function is called by every interaction to ensure changes happen to the correct pane
// therefore, be careful when introducing expensive operations here.
function setPane(paneId, make = false, force = false) {
  const panes = getPanes();

  if (panes[paneId]) {
    if (pane && pane.id && panes[pane.id]) {
      if (force || pane.id !== paneId) {
        document.getElementById(pane.id).classList.remove("active-pane");
      } else {
        return; // nothing to change, avoid extra computations
      }
    }

    pane = panes[paneId];

    if (!pane.cy) {
      // since panes and graphs need to be spawned and then linked,
      // this error happens if the main view (node-link.js) didn't assign pane.cy
      console.error("Active pane has no engine assigned.");
    }

    if (make) {
      makeLayout(pane.cy.params);
      pane.cy._layout.run();
    }

    document.onkeydown = (e) => pane.cy.vars["ur"].fn(pane.cy, e);
    document.getElementById("selected-pane").innerHTML = paneId;
    document.getElementById(pane.id).classList.add("active-pane");
    createControllers(pane.cy.params);

    socket.emit("active pane", paneId);
    return pane.cy;
  } else {
    console.error("Attempted to activate a non-existing pane.");
  }
}

// creates and runs a similar
function makeLayout(opts, overwrite = false) {
  if (overwrite) {
    pane.cy.params = {};
  }

  for (var i in opts) {
    pane.cy.params[i] = opts[i];
  }

  pane.cy._layout = pane.cy.layout(pane.cy.params);
}

function makeTippy(node, html, id) {
  if (tippies[id]) {
    tippies[id].hide();
    tippies[id].destroy();
  }

  const t = tippy(node.popperRef(), {
    title: id,
    html: html,
    trigger: "manual",
    arrow: true,
    placement: "bottom",
    hideOnClick: false,
    interactive: true,
  }).tooltips[0];

  tippies[id] = t;
  tippies[id].show();
}

function hideAllTippies() {
  Object.values(tippies).forEach((t) => {
    t.hide();
    t.destroy();
  });
  tippies = {};
}

// determines which layout values will be used (default cola-params.js)
function createControllers(params) {
  // props
  $props_config.innerHTML = "";
  
  makeSchedulerPropDropdown();
  makeDetailCheckboxes();
  makeAppendDropdown();
  makeSelectionModesDropdown();
  makeFullSyncToggle();

  // graph view settings
  $graph_config.innerHTML = "";

  // layout settings
  $cy_config.innerHTML = "";
  makeLayoutDropdown();

  if (params.controls) {
    params.controls.forEach((c) => {
      if (c.type === "button") {
        makeParamButton(c);
      } else if (c.type === "slider") {
        makeParamSlider(c);
      } else if (c.type === "dropdown") {
        makeParamDropdown(c);
      } else if (c.type === "toggle") {
        makeParamToggle(c);
      }
    });
  }

  makeImportExport();

  // recurring nodes setting
  makeRecurringNodeMarkSettings();
  

  // pcp config
  $pcp_config.innerHTML = "";
  makePCPSettings();

  // overview setting
  $overview_config.innerHTML = "";
  makeOverviewSettings();
}

function makeParamSlider(opts) {
  const value = opts.subParam
    ? pane.cy.params[opts.param][opts.subParam]
    : pane.cy.params[opts.param];
  const $input = h("input", {
    id: "slider-" + opts.param,
    type: "range",
    min: opts.min,
    max: opts.max,
    step: opts.step ? opts.step : 1,
    value: value,
    class: "slider param-" + opts.param,
    oninput: "this.nextElementSibling.value = this.value",
  });

  const $param = h("div", { class: "param" });
  const $label = h(
    "p",
    { class: "label label-default", for: "slider-" + opts.param },
    [t(opts.label)]
  );
  const $output = h("output", { style: "font-size: 10px" }, [t(value)]);

  $param.appendChild($label);
  $param.appendChild(h("div", { style: "display:flex;" }, [$input, $output]));

  $cy_config.appendChild($param);

  const update = _.throttle(() => {
    if (opts.subParam) {
      if (!pane.cy.params[opts.param]) {
        pane.cy.params[opts.param] = {};
      }
      pane.cy.params[opts.param][opts.subParam] = +$input.value;
    } else {
      pane.cy.params[opts.param] = +$input.value;
    }
    pane.cy._layout.stop();
    makeLayout(pane.cy.params);
    pane.cy._layout.run();
  }, 500);

  $input.addEventListener("input", update);
  //$input.addEventListener('change', update);
}

function makeParamButton(opts) {
  const $param = h("div", { class: "", style: "display: flex" });

  const $button = h(
    "button",
    {
      class: "ui button param param-" + opts.param,
    },
    [h("span", {}, [t(opts.label)])]
  );

  $button.addEventListener("click", function () {
    pane.cy._layout.stop();

    if (opts.fn) {
      opts.fn();
    }

    makeLayout(opts.layoutOpts);
    pane.cy._layout.run();
  });

  $param.appendChild($button);
  $cy_config.appendChild($param);
}

function makeParamToggle(opts) {
  const value = opts.subParam
    ? pane.cy.params[opts.param][opts.subParam]
    : pane.cy.params[opts.param];

  const $label = h("label", { class: "label label-default" }, [t(opts.label)]);
  const $param = h("div", {
    class: "param ui small checkbox",
    style: "display: flex",
  });
  const $toggle = h("input", {
    type: "checkbox",
    name: "checkbox" + opts.param,
    id: "checkbox-" + opts.param,
    class: "param-" + opts.param,
    style: "margin-right: 5px",
  });

  $toggle.checked = value;

  $param.appendChild($toggle);
  $param.appendChild($label);

  const update = (e) => {
    if (opts.subParam) {
      if (!pane.cy.params[opts.param]) {
        pane.cy.params[opts.param] = {};
      }
      pane.cy.params[opts.param][opts.subParam] = e.target.checked;
    } else {
      pane.cy.params[opts.param] = e.target.checked;
    }

    pane.cy._layout.stop();
    makeLayout(pane.cy.params);
    pane.cy._layout.run();
  };

  $toggle.addEventListener("change", update);
  $cy_config.appendChild($param);
}

function makeParamDropdown(opts) {
  _makeDropdown(
    opts.options,
    opts.subParam
      ? pane.cy.params[opts.param][opts.subParam]
      : pane.cy.params[opts.param],
    (value) => {
      if (opts.subParam) {
        if (!pane.cy.params[opts.param]) {
          pane.cy.params[opts.param] = {};
        }
        pane.cy.params[opts.param][opts.subParam] = value;
      } else {
        pane.cy.params[opts.param] = value;
      }

      pane.cy._layout.stop();
      makeLayout(pane.cy.params);
      pane.cy._layout.run();
    },
    "select-" + opts.param,
    opts.label,
    $cy_config
  );
}

function makeSelectionModesDropdown() {
  const modes = {
    s: { value: "s", name: "States" },
    t: { value: "t", name: "Actions" },
    "s+t": { value: "s+t", name: "States & Actions" },
  };

  _makeDropdown(
    Object.values(modes),
    pane.cy.vars["mode"].value,
    (value) => {
      pane.cy.vars["mode"].fn(pane.cy, value);
    },
    "selection-mode",
    "Selection mode",
    $props_config
  );
}

function makeSchedulerPropDropdown() {
  const options = Object.keys(
    info.metadata['Scheduler'] // only scheduler from the 'details'
  ).map(k => { return { value: k, name: k } });
  options.push({ value: "_none_", name: "No scheduler" });

  _makeDropdown(
    Object.values(options),
    pane.cy.vars["scheduler"].value,
    (value) => {
      pane.cy.vars["scheduler"].fn(pane.cy, value);
    },
    "scheduler-prop",
    "Scheduler (DOI)",
    $props_config
  );

  const $param = h("div", { class: "param" });
  const $label = h("p", { class: "label label-default param" }, [
    t("Simulation Steps"),
  ]);
  const $numberInput = h("input", {
    type: "number",
    name: "bestPathLength",
    id: "bestPathLength",
    value: 5,
  });
  const update = (e) => {
    const value = e.target.value;
    setMaxIteration(value);
  };
  $numberInput.addEventListener("input", update);

  $param.appendChild($label);
  $param.appendChild($numberInput);
  $props_config.appendChild($param);
}

function updatePropsValues() {
  const original = pane.cy.vars["details"].value;
  const update = {};

  Object.keys(original).forEach((d) => {
    update[d] = {
      all: document.getElementById(`checkbox-${d}`).checked,
      props: {},
    };
    Object.keys(original[d].props).forEach((p) => {
      update[d].props[p] = document.getElementById(
        `checkbox-${d}-${p}`
      ).checked;
    });
  });

  return update;
}

function makeDetailCheckboxes() {
  const $param =
    document.getElementById("props-checkboxes") ||
    h("div", {
      class: "param",
      id: "props-checkboxes",
      style: "display: block",
    });
  const $label = h(
    "span",
    { id: "props-checkboxes-label", class: "label label-default" },
    [t("Details to show")]
  );

  $param.innerHTML = "";
  $param.appendChild($label);

  const options = pane.cy.vars["details"].value;

  Object.keys(options).forEach((k) => {
    const $toggle = h("input", {
      type: "checkbox",
      class: "checkbox-prop",
      id: `checkbox-${k}`,
      name: `checkbox-${k}`,
      style: "margin-right: 5px",
      value: k,
    });

    const $option_label = h("details", { class: "ui accordion" }, [
      h("summary", { class: "title", style: "display:flex" }, [
        h("i", { class: "dropdown icon left" }, []),
        h("div", { class: "ui checkbox" }, [$toggle, h("label", {}, [t(k)])]),
      ]),
      h("div", { class: "content" }, [
        ...makeDetailPropsCheckboxes(options[k].props, k),
      ]),
    ]);

    $toggle.checked = options[k].all;

    $toggle.addEventListener("change", (e) => {
      Object.keys(options[k].props).forEach((p) => {
        document.getElementById(`checkbox-${k}-${p}`).checked =
          e.target.checked;
      });
      pane.cy.vars["details"].fn(pane.cy, {
        update: updatePropsValues(),
        mode: false,
      });
    });

    $param.appendChild($option_label);
  });

  $props_config.appendChild($param);
}

function makeDetailPropsCheckboxes(options, propsName) {
  const toggles = [];
  const $param = h("div", {
    class: "prop-checkboxes",
    id: `props-checkboxes-${propsName}`,
    style: "display: block",
  });
  const meta = pane.cy.vars["details"].value[propsName].metadata;

  Object.keys(options).forEach((k) => {
    const $toggle = h("input", {
      type: "checkbox",
      class: "checkbox-prop",
      id: `checkbox-${propsName}-${k}`,
      name: `checkbox-${propsName}-${k}`,
      style: "margin-right: 5px",
      value: k,
    });

    const html =
      meta[k] && meta[k].identifier
        ? [
          meta[k].icon
            ? h("i", { class: meta[k].identifier + " prop-text-label-icon" })
            : h("span", { class: "prop-text-label-icon" }, [ t(meta[k].identifier), ]),
          t(k),
        ]
        : [t(k)];

    const $option_label = h(
      "div",
      {
        class: "prop-text ui checkbox",
        style: "display:flex",
      },
      [
        $toggle,
        h("label", {}, [h("p", { class: "prop-text-label-text" }, html)]),
      ]
    );

    $toggle.checked = options[k];

    $toggle.addEventListener("change", (e) => {
      pane.cy.vars["details"].fn(pane.cy, {
        update: updatePropsValues(),
        mode: false,
      });
    });

    $param.appendChild($option_label);
    toggles.push($param);
  });

  return toggles;
}

function makeLayoutDropdown() {
  _makeDropdown(
    Object.values(layoutTemplates),
    pane.cy.params.name,
    (value) => {
      pane.cy._layout.stop();
      const params = structuredClone(layoutTemplates[value].data);
      makeLayout(params, true);
      createControllers(params);
      pane.cy._layout.run();
      pane.cy.fit();
    },
    "select-layout",
    "Layout",
    $cy_config
  );
}

function makeImportExport() {
  const $buttons = h("div", { class: "buttons param" }, []);
  const $buttonImport = h("button", { class: "ui button" }, [
    h("span", {}, [t("Import")]),
  ]);
  const $buttonExport = h("button", { class: "ui button" }, [
    h("span", {}, [t("Export")]),
  ]);

  $buttons.appendChild($buttonImport);
  $buttons.appendChild($buttonExport);

  $buttonExport.addEventListener("click", async function () {
    if (pane.cy) {
      pane.cy.fns.export(pane.cy);
    } else {
      console.error("No active pane to export");
    }
  });

  $buttonImport.addEventListener("click", async function () {
    if (pane.cy) {
      pane.cy.fns.import(pane.cy);
    } else {
      console.error("No active pane to import");
    }
  });

  $graph_config.appendChild($buttons);
}

function _makeDropdown(options, value, fn, id, name, where) {
  const $select = h("select", {
    id: id,
    class: "dropdown",
  });

  options.forEach((option) => {
    const $option = h("option", { value: option.value }, [t(option.name)]);
    $select.appendChild($option);
  });

  const $param = h("div", { class: "param" });
  const $label = h("span", { class: "label label-default", for: id }, [
    t(name),
  ]);

  $param.appendChild($label);
  $param.appendChild($select);
  where.appendChild($param);

  $select.value = value;
  const update = _.throttle(() => fn($select.value), 500);
  $select.addEventListener("change", update);
}

function makePCPSettings() {
  const pcp_modes = [
    { value: "manual", name: "Manual", data: {} },
    { value: "core-details", name: "Model to Details", data: {} },
    { value: "details-core", name: "Details to Model", data: {} },
  ];

  $pcp_config.innerHTML = "";
    /*_makeDropdown(
        pcp_modes,
        pcp_modes[0].value,
        (value) => {

        },
        'select-coordination-mode',
        'View Coordination',
        $pcp_config
    )*/ const countPrinter = h("div", { class: "content" });
  countPrinter.innerHTML = `<pre id="count" style="height: 20px; font-size: 10px">${
    pane.cy.pcp
      ? "Selected elements: " + pane.cy.pcp.getSelection().length
      : null
    }</pre>`;
  $pcp_config.appendChild(countPrinter);

  const jsonPrinter = h("div", { class: "content" });
  jsonPrinter.innerHTML = `<pre id="json" style="max-height: 500px; overflow-y:auto; font-size: 10px">${
    pane.cy.pcp
      ? JSON.stringify(pane.cy.pcp.getSelection(), undefined, 2)
      : null
    }</pre>`;
  const $label = h("details", { class: "ui accordion" }, [
    h("summary", { class: "title" }, [
      h("i", { class: "dropdown icon left" }, []),
      t("Selection Printout"),
    ]),
    jsonPrinter,
  ]);
  $pcp_config.appendChild($label);

  const $buttons = h("div", { class: "buttons param" }, []);
  const $buttonExport = h("button", { class: "ui button" }, [
    h("span", {}, [t("Export Selection")]),
  ]);

  $buttons.appendChild($buttonExport);

  $pcp_config.appendChild($buttons);
  $buttonExport.addEventListener("click", function () {
    if (pane.cy.pcp) {
      pane.cy.fns.export(
        pane.cy,
        pane.cy.pcp.getSelection().map((d) => d.id)
      );
    } else {
      document.getElementById("json").textContent = "No Inspection View";
    }
  });
}

function makeRecurringNodeMarkSettings() {
  const $buttons = h(
    "div",
    { class: "buttons param", id: "parent-button" },
    []
  );
  const $buttonMark = h("button", { class: "ui button", id: "child-button" }, [
    h("span", {}, [t("Mark recurring")]),
  ]);

  const $buttonUnmark = h(
    "button",
    { class: "ui button", id: "child-button" },
    [h("span", {}, [t("Unmark recurring")])]
  );

  $buttonMark.addEventListener("click", async function () {
    markRecurringNodes();
  });

  $buttonUnmark.addEventListener("click", async function () {
    unmarkRecurringNodes();
  });

  $buttons.appendChild($buttonMark);
  $buttons.appendChild($buttonUnmark);
  $graph_config.appendChild($buttons);
}

function makeAppendDropdown() {
  const appendOptions = {
    append: { value: "end", name: "Append to the end" },
    insert: { value: "insert", name: "Insert after active pane" },
  };

  _makeDropdown(
    Object.values(appendOptions),
    pane.cy.vars["panePosition"].value,
    (value) => {
      pane.cy.vars["panePosition"].fn(pane.cy, value);
    },
    "select-pane-position",
    "New Pane Position",
    $props_config
  );
}

function makeFullSyncToggle() {
  const param = "fullSync"
  const value = pane.cy.vars[param].value;

  const $label = h("label", { class: "label label-default" }, [
    t("Automatically synchronize selections")
  ]);
  const $param = h("div", {
    class: "param ui small checkbox",
    style: "display: flex",
  });
  const $toggle = h("input", {
    type: "checkbox",
    name: "checkbox" + param,
    id: "checkbox-" + param,
    class: "param-" + param,
    style: "margin-right: 5px",
  });

  $toggle.checked = value;
  $param.appendChild($toggle);
  $param.appendChild($label);

  const update = (e) => {
    pane.cy.vars["fullSync"].fn(pane.cy,  e.target.checked)
  };

  $toggle.addEventListener("change", update);
  $props_config.appendChild($param);
}

function makeOverviewSettings() {
  const $buttonOverview = h(
    "button",
    { class: "ui button", id: "child-button" },
    [h("span", {}, [t("Show Overview Window")])]
  );
  $buttonOverview.addEventListener("click", async function () {
    // Open a new window
    window.open("/overview", "New Window", "width=800,height=600");
  });
  $overview_config.appendChild($buttonOverview);
}

export { makeTippy, hideAllTippies, setPane, PROJECT };
