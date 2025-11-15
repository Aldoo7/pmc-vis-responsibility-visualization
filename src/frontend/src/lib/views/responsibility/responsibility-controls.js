import { socket } from '../imports/import-socket.js';
import { getPanes } from '../panes/panes.js';
import { PROJECT } from '../../utils/controls.js';

let isRunning = false;
let isPaused = false;
let lastComponentResponsibility = null; // cache latest component map

function getActiveProjectId() {
  const el = document.getElementById('project-id');
  const uiId = el && el.textContent ? el.textContent.trim() : '';
  return uiId || PROJECT;
}

// Initialize responsibility controls
export function initResponsibilityControls() {
  const startBtn = document.getElementById('resp-start');
  const cancelBtn = document.getElementById('resp-cancel');
  const clearBtn = document.getElementById('resp-clear');
  const statusDiv = document.getElementById('resp-status');
  const statusText = document.getElementById('resp-status-text');

  // Load saved configuration from localStorage
  loadSavedConfig();

  startBtn.addEventListener('click', () => {
    const mode = document.getElementById('resp-mode').value;
    const powerIndex = document.getElementById('resp-power-index').value;

    // Save configuration
    saveConfig();

    // Send start event
    socket.emit('responsibility:start', {
      modelFile: 'current',
      property: 'current',
      targetLevel: 1,
      mode: mode,
      powerIndex: powerIndex,
      counterexample: null,
      projectId: getActiveProjectId()
    });

    // Update UI state
    isRunning = true;
    isPaused = false;
    updateButtonStates();
    statusDiv.style.display = 'block';
    statusText.textContent = 'Running...';
  });

  cancelBtn.addEventListener('click', () => {
    socket.emit('responsibility:cancel');
    isRunning = false;
    isPaused = false;
    updateButtonStates();
    statusText.textContent = 'Cancelled';
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 2000);
  });

  clearBtn.addEventListener('click', () => {
    clearResponsibilityVisualization();
    statusDiv.style.display = 'none';
  });

  // Listen for status updates
  socket.on('responsibility:status', (data) => {
    const state = data.state || data.status; // backend sends 'state'
    const message = data.message || state;
    // surface model upload feedback in the same area
    if (state === 'completed') {
      isRunning = false;
      isPaused = false;
      updateButtonStates();
      statusText.textContent = 'Completed';
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    } else if (state === 'invalid-config') {
      isRunning = false;
      isPaused = false;
      updateButtonStates();
      statusText.textContent = `Error: ${message}`;
    } else {
      statusText.textContent = message;
    }
  });

  // Listen for results and aggregate components from current graph + state responsibilities
  socket.on('responsibility:result', (_data) => {
    // Defer aggregation slightly to allow graph updater to set node responsibility
    setTimeout(() => {
      const fromGraph = aggregateComponentsFromGraph() || {};
      const fromBackend = (_data && _data.componentResponsibility) ? _data.componentResponsibility : {};
      // Merge: backend (modules/actions parsed from model) + graph-derived actions
      const compMap = { ...fromBackend, ...fromGraph };
      lastComponentResponsibility = compMap;
      renderComponentTable(lastComponentResponsibility);
    }, 120);
  });

  updateButtonStates();
}

function updateButtonStates() {
  const startBtn = document.getElementById('resp-start');
  const cancelBtn = document.getElementById('resp-cancel');

  startBtn.disabled = isRunning;
  cancelBtn.disabled = !isRunning;
}

function clearResponsibilityVisualization() {
  const panes = getPanes();
  Object.values(panes).forEach(pane => {
    if (pane.cy) {
      pane.cy.startBatch();
      pane.cy.$('node.s').forEach(node => {
        node.removeData('responsibility');
        node.removeData('responsibilityTooltip');
        node.removeClass('resp-high resp-medium resp-low');
      });
      pane.cy.endBatch();
    }
  });

  // Clear component table
  lastComponentResponsibility = null;
  const tbody = document.querySelector('#component-resp-table tbody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#888; text-align:center">No data yet</td></tr>';
  }
}

function saveConfig() {
  localStorage.setItem('resp_mode', document.getElementById('resp-mode').value);
  localStorage.setItem('resp_powerIndex', document.getElementById('resp-power-index').value);
}

function loadSavedConfig() {
  const mode = localStorage.getItem('resp_mode');
  const powerIndex = localStorage.getItem('resp_powerIndex');

  if (mode) document.getElementById('resp-mode').value = mode;
  if (powerIndex) document.getElementById('resp-power-index').value = powerIndex;
}

// Helpers for component panel
function aggregateComponentsFromGraph() {
  // Aggregate action labels: average responsibility of source states over edges with that label
  const panes = getPanes();
  const sums = new Map();
  const counts = new Map();

  Object.values(panes).forEach(pane => {
    const cy = pane.cy;
    if (!cy) return;
    cy.edges().forEach(e => {
      const label = e.data('label');
      if (!label) return;
      const sourceId = e.data('source');
      if (!sourceId) return;
      const src = cy.$('#' + sourceId);
      if (src.empty()) return;
      const resp = src.data('responsibility');
      if (resp == null || isNaN(resp)) return;
      const key = 'action_' + label;
      sums.set(key, (sums.get(key) || 0) + Number(resp));
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });

  const result = {};
  Array.from(sums.entries()).forEach(([k, s]) => {
    const c = counts.get(k) || 1;
    result[k] = s / c; // average responsibility
  });
  return result;
}

function renderComponentTable(componentMap) {
  const tbody = document.querySelector('#component-resp-table tbody');
  if (!tbody) return;

  if (!componentMap || Object.keys(componentMap).length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#888; text-align:center">No components</td></tr>';
    return;
  }

  // Sort by value desc
  const rows = Object.entries(componentMap)
    .map(([name, value]) => ({ name, value: Number(value) }))
    .sort((a, b) => b.value - a.value);

  // Determine max for scale width
  const max = rows[0].value || 1;

  const format = (v) => (v * 100).toFixed(2) + '%';
  const colorFor = (v) => {
    // simple green->orange->red ramp based on thresholds
    if (v > 0.7) return '#c74444';
    if (v > 0.4) return '#e87d1e';
    return '#5ca65c';
  };

  tbody.innerHTML = rows.map(r => {
    const width = Math.max(4, Math.round((r.value / max) * 100));
    const color = colorFor(r.value);
    return `
      <tr>
        <td style="word-break:break-all">${escapeHtml(r.name)}</td>
        <td style="text-align:right">${format(r.value)}</td>
        <td>
          <div style="height:10px; background:#f3f3f3; border-radius:4px; overflow:hidden">
            <div style="height:10px; width:${width}%; background:${color}"></div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
