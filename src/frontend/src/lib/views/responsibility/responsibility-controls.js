import { socket } from '../imports/import-socket.js';
import { getPanes } from '../panes/panes.js';
import { PROJECT } from '../../utils/controls.js';
import { initFilteringControls, updateStateResponsibility, clearFiltering } from './filtering.js';
import { initComparisonControls, clearComparison, exportComparisonCSV } from './comparison.js';

let isRunning = false;
let isPaused = false;
let lastComponentResponsibility = null; // cache latest component map
let lastStateResponsibility = null; // cache latest state responsibility data

function getActiveProjectId() {
  const el = document.getElementById('project-id');
  const uiId = el && el.textContent ? el.textContent.trim() : '';
  return uiId || PROJECT;
}

// Initialize responsibility controls
// Track if controls have been initialized to prevent duplicate event listeners
let controlsInitialized = false;

export function initResponsibilityControls() {
  // Only initialize once to prevent duplicate event listeners
  if (controlsInitialized) {
    return;
  }
  controlsInitialized = true;

  const startBtn = document.getElementById('resp-start');
  const cancelBtn = document.getElementById('resp-cancel');
  const clearBtn = document.getElementById('resp-clear');
  const statusDiv = document.getElementById('resp-status');
  const statusText = document.getElementById('resp-status-text');

  // Load saved configuration from localStorage
  loadSavedConfig();
  
  // Initialize filtering controls
  initFilteringControls();
  
  // Initialize comparison controls
  initComparisonControls();
  
  // CSV export button
  const exportCsvBtn = document.getElementById('export-comparison-csv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportComparisonCSV);
  }

  startBtn.addEventListener('click', () => {
    const mode = document.getElementById('resp-mode').value;
    const powerIndex = document.getElementById('resp-power-index').value;

    // Save configuration
    saveConfig();

    const payload = {
      modelFile: 'current',
      property: 'current',
      targetLevel: 1,
      mode: mode,
      powerIndex: powerIndex,
      counterexample: null,
      projectId: getActiveProjectId()
    };

    socket.emit('responsibility:start', payload);

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
    clearFiltering();
    clearComparison();
    statusDiv.style.display = 'none';
  });

  // Copy button for state responsibility
  const copyBtn = document.getElementById('copy-state-resp-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copyStateResponsibilityToClipboard();
    });
  }

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
    if (_data && _data.stateResponsibility) {
      lastStateResponsibility = _data.stateResponsibility;
      updateStateResponsibility(_data.stateResponsibility);
      renderStateResponsibilityTable(_data.stateResponsibility);
    }
    
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
  
  // Clear state table
  lastStateResponsibility = null;
  const stateTbody = document.querySelector('#state-resp-table tbody');
  if (stateTbody) {
    stateTbody.innerHTML = '<tr><td colspan="3" style="color:#888; text-align:center">No data yet</td></tr>';
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

function renderStateResponsibilityTable(stateResponsibilityMap) {
  const tbody = document.querySelector('#state-resp-table tbody');
  if (!tbody) return;

  if (!stateResponsibilityMap || Object.keys(stateResponsibilityMap).length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#888; text-align:center">No data yet</td></tr>';
    return;
  }

  // Sort states by responsibility value (descending)
  const rows = Object.entries(stateResponsibilityMap)
    .map(([stateId, value]) => ({ stateId, value: Number(value) }))
    .filter(r => !isNaN(r.value))
    .sort((a, b) => b.value - a.value);

  // Show top 10 only
  const top10 = rows.slice(0, 10);

  // Calculate total for percentage
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  
  // Determine thresholds for coloring (same as graph: top 30% = high, next 40% = medium)
  const positives = rows.filter(r => r.value > 0);
  const highCutoff = Math.max(1, Math.ceil(positives.length * 0.3));
  const medCutoff = Math.max(highCutoff + 1, Math.ceil(positives.length * 0.7));

  tbody.innerHTML = top10.map((r, idx) => {
    const percentage = total > 0 ? ((r.value / total) * 100).toFixed(2) : '0.00';
    const valueStr = r.value.toFixed(8);
    
    // Determine color based on quantile
    let colorClass = '';
    let badge = '';
    if (r.value > 0) {
      const posIdx = positives.findIndex(p => p.stateId === r.stateId);
      if (posIdx < highCutoff) {
        colorClass = 'background: #ffe0e0; border-left: 3px solid #ff6b6b;';
        badge = '<span style="background:#ff6b6b; color:white; padding:2px 6px; border-radius:3px; font-size:10px; margin-left:5px;">HIGH</span>';
      } else if (posIdx < medCutoff) {
        colorClass = 'background: #fff3e0; border-left: 3px solid #ffa726;';
        badge = '<span style="background:#ffa726; color:white; padding:2px 6px; border-radius:3px; font-size:10px; margin-left:5px;">MED</span>';
      } else {
        colorClass = 'background: #e8f5e9; border-left: 3px solid #66bb6a;';
        badge = '<span style="background:#66bb6a; color:white; padding:2px 6px; border-radius:3px; font-size:10px; margin-left:5px;">LOW</span>';
      }
    }
    
    return `
      <tr style="${colorClass}">
        <td>State ${r.stateId}${badge}</td>
        <td style="text-align:right">${valueStr}</td>
        <td style="text-align:right">${percentage}%</td>
      </tr>
    `;
  }).join('');
  
  // Store the data for copying
  lastStateResponsibility = stateResponsibilityMap;
}

function copyStateResponsibilityToClipboard() {
  if (!lastStateResponsibility || Object.keys(lastStateResponsibility).length === 0) {
    alert('No state responsibility data available to copy');
    return;
  }

  // Sort states by responsibility value (descending)
  const rows = Object.entries(lastStateResponsibility)
    .map(([stateId, value]) => ({ stateId, value: Number(value) }))
    .filter(r => !isNaN(r.value))
    .sort((a, b) => b.value - a.value);

  // Calculate total for percentage
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  // Create text format similar to command-line output
  let text = 'State Responsibility Values\n';
  text += '='.repeat(50) + '\n\n';
  text += 'State ID\tValue\t\t% of Total\n';
  text += '-'.repeat(50) + '\n';

  rows.forEach(r => {
    const percentage = total > 0 ? ((r.value / total) * 100).toFixed(2) : '0.00';
    const valueStr = r.value.toFixed(8);
    text += `State ${r.stateId}\t${valueStr}\t${percentage}%\n`;
  });

  text += '\n' + '='.repeat(50) + '\n';
  text += `Total: ${rows.length} states\n`;
  text += `Sum: ${total.toFixed(8)}\n`;

  // Copy to clipboard
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-state-resp-btn');
    if (btn) {
      const originalText = btn.innerHTML;
      btn.innerHTML = 'Copied!';
      btn.style.background = '#5ca65c';
      btn.style.color = '#fff';
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = '';
        btn.style.color = '';
      }, 2000);
    }
  }).catch(err => {
    console.error('Failed to copy:', err);
    alert('Failed to copy to clipboard');
  });
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
