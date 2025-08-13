import { _ } from 'lodash';
import tippy from 'tippy.js';

import { info, setInfo, BACKEND } from '../main/main.js';
import { getPanes } from '../views/panes/panes.js';
import { h, t } from './utils.js';

// import { params as _elk } from '../views/graph/layout-options/elk.js';
import { params as _dagre } from '../views/graph/layout-options/dagre.js';
import { params as _klay } from '../views/graph/layout-options/klay.js';
import { params as _cola } from '../views/graph/layout-options/cola.js';
import { CONSTANTS } from './names.js';
import { handleEditorSelection } from '../views/editor.js';
import {
  markRecurringNodes,
  setMaxIteration,
  unmarkRecurringNodes,
} from '../views/graph/node-link.js';
import { socket } from '../views/imports/import-socket.js';

const $ = document.querySelector.bind(document);
const $cy_config = $('#cy-config');
const $graph_config = $('#graph-config');
const $pcp_config = $('#pcp-config');
const $props_config = $('#props-config');
const $overview_config = $('#overview-config');

const url = new URL(window.location.href);
const params = new URLSearchParams(url.search);
const PROJECT = params.get('id') || 0;

let pane = null;
let tippies = {};
let opened = {};

const layoutTemplates = {
  cola: { value: 'cola', name: 'Cola', data: _cola },
  klay: { value: 'klay', name: 'Klay', data: _klay },
  dagre: { value: 'dagre', name: 'Dagre', data: _dagre },
  // elk: { value: 'elk', name: 'ELK', data: _elk },
};

const spinningIcon = 'loading spinner icon trigger-check-prop';
const triggerIcon = 'fa fa-rocket trigger-check-prop';

// updates all graphs active canvas space when a pane resize happens
$('#config-toggle')?.addEventListener('click', () => {
  $('body').classList.toggle('config-closed');
  $('#config-toggle').classList.toggle('icon-inactive');
  $('#config-toggle i').classList.toggle('fa-chevron-right');
  $('#config-toggle i').classList.toggle('fa-chevron-left');
  if (pane && pane.cy) {
    pane.cy.resize();
  }
});

// panes and settings rely heavily on this function to work
// this function is called by every interaction to ensure changes happen to the correct pane
// therefore, be careful when introducing expensive operations here.
async function setPane(paneId, { make = false, force = false } = {}) {
  const panes = getPanes();

  if (panes[paneId]) {
    if (pane && pane.id && panes[pane.id]) {
      if (force || pane.id !== paneId) {
        document.getElementById(pane.id).classList.remove('active-pane');
      } else {
        return; // nothing to change, avoid extra computations
      }
    }

    pane = panes[paneId];

    if (!pane.cy) {
      // since panes and graphs need to be spawned and then linked,
      // this error happens if the main view (node-link.js) didn't assign pane.cy
      console.error('Active pane has no engine assigned.');
    }

    if (make) {
      makeLayout(pane.cy.params);
      pane.cy._layout.pon('layoutstop', () => {
        const d = document.querySelector(`#${pane.id}  canvas`);
        d.pane = pane.id;
        info.observer.observe(d);
      });
      pane.cy._layout.run();
    }

    document.onkeydown = (e) => pane.cy.vars['ur'].fn(pane.cy, e);
    document.getElementById('selected-pane').innerHTML = paneId;
    document.getElementById(pane.id).classList.add('active-pane');
    if (info.updating) {
      await pane.cy.vars['update'].fn();
    }

    createControllers(pane.cy.params);

    socket.emit('active pane', paneId);
    handleEditorSelection(undefined, pane.cy);
    return pane.cy;
  } else {
    console.error('Attempted to activate a non-existing pane.');
  }
}

// creates and runs a similar
function makeLayout(opts, overwrite = false) {
  if (overwrite) {
    pane.cy.params = {};
  }

  Object.keys(opts).forEach(i => {
    pane.cy.params[i] = opts[i];
  });

  pane.cy._layout = pane.cy.layout(pane.cy.params);
}

function makeTippy(node, html, id) {
  if (tippies[id]) {
    tippies[id].hide();
    tippies[id].destroy();
    delete tippies[id];
    return;
  }

  const t = tippy(node.popperRef(), {
    title: id,
    html: html,
    trigger: 'manual',
    arrow: true,
    placement: 'bottom',
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
  Array.from(document.getElementsByTagName('details'))
    .filter(d => d.id)
    .forEach(d => {
      opened[d.id] = d.open;
    });

  // props
  $props_config.innerHTML = '';

  makeSchedulerPropDropdown();
  makeDetailCheckboxes();
  makeAppendDropdown();
  makeSelectionModesDropdown();

  // graph view settings
  $graph_config.innerHTML = '';

  // layout settings
  $cy_config.innerHTML = '';
  makeLayoutDropdown();

  if (params.controls) {
    params.controls.forEach((c) => {
      if (c.type === 'button') {
        makeParamButton(c);
      } else if (c.type === 'slider') {
        makeParamSlider(c);
      } else if (c.type === 'dropdown') {
        makeParamDropdown(c);
      } else if (c.type === 'toggle') {
        makeParamToggle(c);
      }
    });
  }

  makeImportExport();

  // recurring nodes setting
  makeRecurringNodeMarkSettings();

  // pcp config
  $pcp_config.innerHTML = '';
  makePCPSettings();

  // overview setting
  $overview_config.innerHTML = '';
  makeOverviewSettings();
}

function makeParamSlider(opts) {
  const value = opts.subParam
    ? pane.cy.params[opts.param][opts.subParam]
    : pane.cy.params[opts.param];
  const $input = h('input', {
    id: 'slider-' + opts.param,
    type: 'range',
    min: opts.min,
    max: opts.max,
    step: opts.step ? opts.step : 1,
    value: value,
    class: 'slider param-' + opts.param,
    oninput: 'this.nextElementSibling.value = this.value',
  });

  const $param = h('div', { class: 'param' });
  const $label = h(
    'p',
    { class: 'label label-default', for: 'slider-' + opts.param },
    [t(opts.label)],
  );
  const $output = h('output', { style: 'font-size: 10px' }, [t(value)]);

  $param.appendChild($label);
  $param.appendChild(h('div', { style: 'display:flex;' }, [$input, $output]));

  $cy_config.appendChild($param);

  const update = _.throttle(() => {
    if (opts.subParam) {
      pane.cy.params[opts.param] ||= {};
      pane.cy.params[opts.param][opts.subParam] = +$input.value;
    } else {
      pane.cy.params[opts.param] = +$input.value;
    }
    pane.cy._layout.stop();
    makeLayout(pane.cy.params);
    pane.cy._layout.run();
  }, 500);

  $input.addEventListener('input', update);
  // $input.addEventListener('change', update);
}

function makeParamButton(opts) {
  const $param = h('div', { class: '', style: 'display: flex' });

  const $button = h(
    'button',
    {
      class: 'ui button param param-' + opts.param,
    },
    [h('span', {}, [t(opts.label)])],
  );

  $button.addEventListener('click', () => {
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
  const id = `checkbox-${opts.param}${opts.subParam ? opts.subParam : ''}`;

  const value = opts.subParam
    ? pane.cy.params[opts.param][opts.subParam]
    : pane.cy.params[opts.param];

  const $label = h('label', { class: 'label label-default', for: id }, [t(opts.label)]);
  const $param = h('div', {
    class: 'param ui small checkbox',
    style: 'display: flex',
  });
  const $toggle = h('input', {
    type: 'checkbox',
    name: id,
    id: id,
    class: 'param-' + opts.param,
    style: 'margin-right: 5px',
  });

  $toggle.checked = value;

  $param.appendChild($toggle);
  $param.appendChild($label);

  const update = (e) => {
    if (opts.subParam) {
      pane.cy.params[opts.param] ||= {};
      pane.cy.params[opts.param][opts.subParam] = e.target.checked;
    } else {
      pane.cy.params[opts.param] = e.target.checked;
    }

    pane.cy._layout.stop();
    makeLayout(pane.cy.params);
    pane.cy._layout.run();
  };

  $toggle.addEventListener('change', update);
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
        pane.cy.params[opts.param] ||= {};
        pane.cy.params[opts.param][opts.subParam] = value;
      } else {
        pane.cy.params[opts.param] = value;
      }

      pane.cy._layout.stop();
      makeLayout(pane.cy.params);
      pane.cy._layout.run();
    },
    'select-' + opts.param + (opts.subParam ? opts.subParam : ''),
    opts.label,
    $cy_config,
  );
}

function makeSelectionModesDropdown() {
  const modes = {
    s: { value: 's', name: 'States' },
    t: { value: 't', name: 'Actions' },
    's+t': { value: 's+t', name: 'States & Actions' },
  };

  _makeDropdown(
    Object.values(modes),
    pane.cy.vars['mode'].value,
    (value) => {
      pane.cy.vars['mode'].fn(pane.cy, value);
      createControllers(pane.cy.params);
    },
    'selection-mode',
    'Selection mode',
    $props_config,
  );
}

function makeSchedulerPropDropdown() {
  const options = Object.keys(
    info.scheduler, // only scheduler from the 'details'
  ).map(k => {
    return { value: k, name: k };
  }).filter(m => info.scheduler[m.name] === 'ready');

  options.push({ value: '_none_', name: 'No scheduler' });

  _makeDropdown(
    Object.values(options),
    pane.cy.vars['scheduler'].value,
    (value) => {
      pane.cy.vars['scheduler'].fn(pane.cy, value);
    },
    'scheduler-prop',
    'Scheduler (DOI)',
    $props_config,
  );

  const $param = h('div', { class: 'param' });
  const $label = h('p', { class: 'label label-default param' }, [t('Simulation Steps')]);
  const $numberInput = h('input', {
    type: 'number',
    name: 'bestPathLength',
    id: 'bestPathLength',
    value: 5,
    min: 1,
  });
  const update = (e) => {
    const value = e.target.value;
    setMaxIteration(value);
    document.getElementById(`${pane.id}-expandN`).title = `${
      CONSTANTS.INTERACTIONS.expandN.name(value)
    } \t (${
      CONSTANTS.INTERACTIONS.expandN.keyboard
    })`;
    const ctxmenu = document.getElementById('expand-best-path');
    ctxmenu.title = `${
      CONSTANTS.INTERACTIONS.expandN.description(value)
    } \t (${
      CONSTANTS.INTERACTIONS.expandN.keyboard
    })`;
    ctxmenu.innerHTML = CONSTANTS.INTERACTIONS.expandN.name(value);
  };
  $numberInput.addEventListener('input', update);

  $param.appendChild($label);
  $param.appendChild($numberInput);
  $props_config.appendChild($param);
}

function updatePropsValues() {
  const original = pane.cy.vars['details'].value;
  const update = {};

  Object.keys(original).forEach((d) => {
    const cb = document.getElementById(`checkbox-${d}`);
    update[d] = {
      all: cb?.checked,
      props: {},
    };
    Object.keys(original[d].props).forEach((p) => {
      const cbp = document.getElementById(`checkbox-${d}-${p}`);
      update[d].props[p] = cbp?.checked;
    });
  });

  return update;
}

async function status() {
  const data = await socket.emitWithAck('MC_STATUS', PROJECT);
  console.log(data);
  return data;
}

async function triggerModelCheckProperty(e, propType, props) {
  e.target.className = spinningIcon;
  props.forEach((p) => {
    const button = document.getElementById(`trigger-button-${propType}-${p}`);
    if (button) button.className = spinningIcon;
  });

  fetch(
    `${BACKEND}/${PROJECT}/check?property=${props.join(
      '&property=',
    )}`,
    { method: 'GET' },
  );
}

socket.on('MC_STATUS', (status) => {
  console.log(status);
  setInfo(status.info);
  info.updating = true;
  setPane(pane.id, { force: true });
});

async function clear() {
  const request = await fetch(`${BACKEND}/${PROJECT}/clear`, {
    method: 'GET',
  });
  const response = await request.json();

  if (response.content.startsWith(CONSTANTS.MESSAGES.cleared_starts_with)) {
    const state = await status();
    setInfo(state.info);
    setPane(pane.id, { force: true });
  }

  console.log(response);
}

function makeDetailCheckboxes() {
  const $param = document.getElementById('props-checkboxes')
    || h('div', {
      class: 'param',
      id: 'props-checkboxes',
      style: 'display: block',
    });
  const $label = h(
    'span',
    { id: 'props-checkboxes-label', class: 'label label-default' },
    [t('Details to show')],
  );

  $param.innerHTML = '';
  $param.appendChild($label);

  $props_config.insertAdjacentHTML(
    'beforeend',
    `<div class="buttons param"> 
      <button class="ui button" id="clear">
        <span>Clear Properties (Testing)</span>
      </button>
      <button class="ui button" id="status">
        <span>Print Status</span>
      </button>
    </div>`,
  );
  document.getElementById('clear').addEventListener('click', () => clear());
  document.getElementById('status').addEventListener('click', () => status());
  const options = pane.cy.vars['details'].value;
  const mode = pane.cy.vars['mode'].value;

  Object.keys(options).forEach((k) => {
    const $toggle = h('input', {
      type: 'checkbox',
      class: 'checkbox-prop',
      id: `checkbox-${k}`,
      name: `checkbox-${k}`,
      style: 'margin-right: 5px',
      value: k,
    });
    $toggle.checked = options[k].all;

    $toggle.addEventListener('change', (e) => {
      Object.keys(options[k].props).forEach((p) => {
        document.getElementById(`checkbox-${k}-${p}`).checked = e.target.checked;
      });
      pane.cy.vars['details'].fn(pane.cy, {
        update: updatePropsValues(),
      });
    });

    let $input_div = h('div', { class: 'ui small checkbox' }, [$toggle, h('label', { for: `checkbox-${k}` })]);

    if (k === CONSTANTS.results) {
      const keys = Object.keys(options[k].metadata);
      const statuses = {
        ready: new Set(),
        computing: new Set(),
        missing: new Set(),
      };

      keys.forEach((a) => statuses[options[k].metadata[a].status].add(a));

      const ready = statuses.ready.size === keys.length;
      const computing = statuses.computing.size > 0;

      if (!ready) {
        $input_div = h('i', {
          class: computing ? spinningIcon : triggerIcon,
          id: `trigger-button-${k}`,
        });
        $input_div.addEventListener('click', (e) => {
          triggerModelCheckProperty(e, k, Array.from(statuses.missing));
          e.preventDefault();
        });
      }
    }

    if (mode !== 's+t') {
      if (!info.types[k].includes(mode)) return;
    }

    const id = `details-${k}`;
    const $option_label = h('details', {
      id,
      class: 'ui accordion',
    }, [
      h('summary', { class: 'title', style: 'display:flex' }, [
        h('i', { class: 'dropdown icon left' }, []),
        $input_div,
        h('p', { class: 'prop-text-label-text' }, [t(k)]),
      ]),
      h('div', { class: 'content' }, [...makeDetailPropsCheckboxes(options[k], k)]),
    ]);

    if (opened[id]) {
      $option_label.open = true;
    }

    $param.appendChild($option_label);
  });

  $props_config.appendChild($param);
}

function makeDetailPropsCheckboxes(options, propType) {
  const props = options.props;
  const toggles = [];
  const $param = h('div', {
    class: 'prop-checkboxes',
    id: `props-checkboxes-${propType}`,
    style: 'display: block',
  });
  const meta = pane.cy.vars['details'].value[propType].metadata;

  Object.keys(props).forEach((propName) => {
    const checked = props[propName];

    const $toggle = h('input', {
      type: 'checkbox',
      class: 'checkbox-prop',
      id: `checkbox-${propType}-${propName}`,
      name: `checkbox-${propType}-${propName}`,
      style: 'margin-right: 5px',
      value: propName,
    });

    $toggle.checked = checked;

    $toggle.addEventListener('change', () => {
      pane.cy.vars['details'].fn(pane.cy, {
        update: updatePropsValues(),
      });
    });

    let $input_div = h('div', {}, [$toggle, h('label', { for: `checkbox-${propType}-${propName}` })]);

    if (
      propType === CONSTANTS.results
      && options.metadata[propName].status !== CONSTANTS.STATUS.ready
    ) {
      const computing = options.metadata[propName].status === CONSTANTS.STATUS.computing;
      $input_div = h('i', {
        class: computing ? spinningIcon : triggerIcon,
        id: `trigger-button-${propType}-${propName}`,
      });
      $input_div.addEventListener('click', (e) => triggerModelCheckProperty(e, propType, [propName]));
    }

    const html = meta[propName] && meta[propName].identifier
      ? [
        meta[propName].icon
          ? h('i', {
            class: meta[propName].identifier + ' prop-text-label-icon',
          })
          : h('span', { class: 'prop-text-label-icon' }, [t(meta[propName].identifier)]),
        t(propName),
      ]
      : [t(propName)];

    const $div = h(
      'div',
      {
        class: 'prop-text ui small checkbox',
        style: 'display:flex',
      },
      [$input_div, h('p', { class: 'prop-text-label-text' }, html)],
    );

    $param.appendChild($div);
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
    },
    'select-layout',
    'Layout',
    $cy_config,
  );
}

function makeImportExport() {
  const $buttons = h('div', { class: 'buttons param' }, []);
  const $buttonImport = h('button', { class: 'ui button' }, [h('span', {}, [t('Import')])]);
  const $buttonExport = h('button', { class: 'ui button' }, [h('span', {}, [t('Export')])]);

  $buttons.appendChild($buttonImport);
  $buttons.appendChild($buttonExport);

  $buttonExport.addEventListener('click', async () => {
    if (pane.cy) {
      pane.cy.fns.export(pane.cy);
    } else {
      console.error('No active pane to export');
    }
  });

  $buttonImport.addEventListener('click', async () => {
    if (pane.cy) {
      pane.cy.fns.import(pane.cy);
    } else {
      console.error('No active pane to import');
    }
  });

  $graph_config.appendChild($buttons);
}

function _makeDropdown(options, value, fn, id, name, where) {
  const $select = h('select', {
    id: id,
    class: 'dropdown',
  });

  options.forEach((option) => {
    const $option = h('option', { value: option.value }, [t(option.name)]);
    $select.appendChild($option);
  });

  const $param = h('div', { class: 'param' });
  const $label = h('span', { class: 'label label-default', for: id }, [t(name)]);

  $param.appendChild($label);
  $param.appendChild($select);
  where.appendChild($param);

  $select.value = value;
  const update = _.throttle(() => fn($select.value), 500);
  $select.addEventListener('change', update);
}

function makeBoundIndicatorDropdown() {
  const options = {
    append: { value: '><', name: '> <' },
    insert: { value: 'o', name: 'o' },
  };

  _makeDropdown(
    Object.values(options),
    pane.cy.vars['pcp-bi'].value,
    (value) => {
      pane.cy.vars['pcp-bi'].fn(pane.cy, value);
    },
    'pcp-bound-indicator',
    'Indicator of Min/Max Selections',
    $pcp_config,
  );
}

function makePCPSettings() {
  $pcp_config.innerHTML = '';

  $pcp_config.appendChild(
    makeToggle('pcp-auto-sync'),
  );
  $pcp_config.appendChild(
    makeToggle('pcp-refine'),
  );
  $pcp_config.appendChild(
    makeToggle('pcp-hs'),
  );
  $pcp_config.appendChild(
    makeToggle('pcp-dfs'),
  );
  $pcp_config.appendChild(
    makeToggle('pcp-vs'),
  );

  makeBoundIndicatorDropdown();

  const countPrinter = h('div', { class: 'content' });
  countPrinter.innerHTML = `<pre 
    id="count" 
    style="
      height: 20px; 
      font-size: 10px"
    >${
      pane.cy.pcp
        ? 'Selected elements: ' + pane.cy.pcp.getSelection().length
        : null
    }</pre>`;
  $pcp_config.appendChild(countPrinter);

  const jsonPrinter = h('div', { class: 'content' });
  jsonPrinter.innerHTML = `<pre 
    id="json">${
      pane.cy.pcp
        ? JSON.stringify(pane.cy.pcp.getSelection(), undefined, 2)
        : null
    }</pre>`;
  const $label = h(
    'details',
    { class: 'ui accordion' },
    [
      h(
        'summary',
        { class: 'title' },
        [h('i', { class: 'dropdown icon left' }, []), t('Selection Printout')],
      ),
      jsonPrinter,
    ],
  );
  $pcp_config.appendChild($label);

  const $buttons = h('div', { class: 'buttons param' }, []);
  const $buttonExport = h(
    'button',
    { class: 'ui button' },
    [h('span', {}, [t('Export Selection')])],
  );

  $buttons.appendChild($buttonExport);

  $pcp_config.appendChild($buttons);
  $buttonExport.addEventListener('click', () => {
    if (pane.cy.pcp) {
      pane.cy.fns.export(
        pane.cy,
        pane.cy.pcp.getSelection().map((d) => d.id),
      );
    } else {
      document.getElementById('json').textContent = 'No Inspection View';
    }
  });
}

function makeRecurringNodeMarkSettings() {
  const $buttons = h(
    'div',
    { class: 'buttons param', id: 'parent-button' },
    [],
  );
  const $buttonMark = h('button', { class: 'ui button', id: 'child-button' }, [h('span', {}, [t('Mark recurring')])]);

  const $buttonUnmark = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('span', {}, [t('Unmark recurring')])],
  );

  $buttonMark.addEventListener('click', async () => {
    markRecurringNodes();
  });

  $buttonUnmark.addEventListener('click', async () => {
    unmarkRecurringNodes();
  });

  $buttons.appendChild($buttonMark);
  $buttons.appendChild($buttonUnmark);
  $graph_config.appendChild($buttons);
}

function makeAppendDropdown() {
  const appendOptions = {
    append: { value: 'end', name: 'Append to the end' },
    insert: { value: 'insert', name: 'Insert after active pane' },
  };

  _makeDropdown(
    Object.values(appendOptions),
    pane.cy.vars['panePosition'].value,
    (value) => {
      pane.cy.vars['panePosition'].fn(pane.cy, value);
    },
    'select-pane-position',
    'New Pane Position',
    $props_config,
  );
}

function makeToggle(param) {
  const value = pane.cy.vars[param].value;
  const id = `checkbox-${param}`;

  const $label = h('label', {
    class: 'label label-default',
    for: id,
  }, [t(CONSTANTS.CONTROLS[param])]);
  const $param = h('div', {
    class: 'param ui small checkbox',
    style: 'display: flex',
  });
  const $toggle = h('input', {
    type: 'checkbox',
    name: id,
    id: id,
    class: 'param-' + param,
    style: 'margin-right: 5px',
  });

  $toggle.checked = value;
  $param.appendChild($toggle);
  $param.appendChild($label);

  const update = (e) => {
    pane.cy.vars[param].fn(pane.cy, e.target.checked);
  };

  $toggle.addEventListener('change', update);
  return $param;
}

function makeOverviewSettings() {
  const $buttonOverview = h(
    'button',
    { class: 'ui button', id: 'child-button' },
    [h('span', {}, [t('Show Overview Window')])],
  );
  $buttonOverview.addEventListener('click', async () => {
    window.open('/overview/', 'New Window', 'width=800,height=600');
  });
  $overview_config.appendChild($buttonOverview);
}

export {
  makeTippy, hideAllTippies, setPane, PROJECT,
};
