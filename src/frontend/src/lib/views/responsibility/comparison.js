import { socket } from '../imports/import-socket.js';
import { getPanes } from '../panes/panes.js';
import { PROJECT } from '../../utils/controls.js';

let comparisonResults = {
  'shapley-optimistic': null,
  'shapley-pessimistic': null,
  'banzhaf-optimistic': null,
  'banzhaf-pessimistic': null
};

let stateIdToGraphId = null;

let isComputing = false;
let currentModeIndex = 0;
const MODES = [
  { mode: 'optimistic', powerIndex: 'shapley', key: 'shapley-optimistic', label: 'Shap-Opt' },
  { mode: 'pessimistic', powerIndex: 'shapley', key: 'shapley-pessimistic', label: 'Shap-Pes' },
  { mode: 'optimistic', powerIndex: 'banzhaf', key: 'banzhaf-optimistic', label: 'Banz-Opt' },
  { mode: 'pessimistic', powerIndex: 'banzhaf', key: 'banzhaf-pessimistic', label: 'Banz-Pes' }
];

function getActiveProjectId() {
  const el = document.getElementById('project-id');
  const uiId = el && el.textContent ? el.textContent.trim() : '';
  return uiId || PROJECT;
}

export function initComparisonControls() {
  const compareBtn = document.getElementById('resp-compare-all');
  const comparisonStatus = document.getElementById('comparison-status');
  
  if (!compareBtn) {
    return;
  }

  compareBtn.addEventListener('click', () => {
    if (isComputing) return;
    startComparison();
  });

  socket.on('responsibility:result', handleComparisonResult);
  socket.on('responsibility:status', handleComparisonStatus);
}

function startComparison() {
  comparisonResults = {
    'shapley-optimistic': null,
    'shapley-pessimistic': null,
    'banzhaf-optimistic': null,
    'banzhaf-pessimistic': null
  };
  stateIdToGraphId = null;
  currentModeIndex = 0;
  isComputing = true;

  // Update UI
  const compareBtn = document.getElementById('resp-compare-all');
  const statusSpan = document.getElementById('comparison-status');
  
  if (compareBtn) {
    compareBtn.disabled = true;
    compareBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Computing...';
  }
  
  if (statusSpan) {
    statusSpan.textContent = `Computing ${MODES[0].label}...`;
    statusSpan.style.display = 'inline';
  }

  renderComparisonTable(null);
  computeNextMode();
}

function computeNextMode() {
  if (currentModeIndex >= MODES.length) {
    finishComparison();
    return;
  }

  const modeConfig = MODES[currentModeIndex];

  const statusSpan = document.getElementById('comparison-status');
  if (statusSpan) {
    statusSpan.textContent = `Computing ${modeConfig.label} (${currentModeIndex + 1}/4)...`;
  }

  const payload = {
    modelFile: 'current',
    property: 'current',
    targetLevel: 1,
    mode: modeConfig.mode,
    powerIndex: modeConfig.powerIndex,
    counterexample: null,
    projectId: getActiveProjectId(),
    _comparisonMode: modeConfig.key
  };

  socket.emit('responsibility:start', payload);
}

function handleComparisonResult(data) {
  if (!isComputing) return;

  const stateCount = data?.stateResponsibility ? Object.keys(data.stateResponsibility).length : 0;
  
  if (!data || !data.stateResponsibility || stateCount === 0) {
    return;
  }

  const responseMode = (data.responsibilityType || 'unknown').toLowerCase();
  const responseIndex = (data.powerIndex || 'unknown').toLowerCase();
  let actualModeKey = `${responseIndex}-${responseMode}`;
  
  if (!comparisonResults.hasOwnProperty(actualModeKey)) {
    actualModeKey = MODES[currentModeIndex].key;
  }
  
  if (!stateIdToGraphId && data.stateIdToName) {
    stateIdToGraphId = buildStateIdToGraphIdMapping(data.stateIdToName);
  }

  const mappedResults = mapStateIdsToGraphIds(data.stateResponsibility);
  comparisonResults[actualModeKey] = mappedResults;
}

function handleComparisonStatus(data) {
  if (!isComputing) return;

  const status = data?.status || data?.state || '';
  
  if (status === 'completed') {
    currentModeIndex++;
    setTimeout(() => computeNextMode(), 300);
  }
}

function finishComparison() {
  isComputing = false;

  // Update UI
  const compareBtn = document.getElementById('resp-compare-all');
  const statusSpan = document.getElementById('comparison-status');

  if (compareBtn) {
    compareBtn.disabled = false;
    compareBtn.innerHTML = '<i class="fa-solid fa-table-columns"></i> Compare All';
  }

  if (statusSpan) {
    statusSpan.textContent = 'Complete!';
    setTimeout(() => {
      statusSpan.style.display = 'none';
    }, 2000);
  }

  renderComparisonTable(comparisonResults);
}

function renderComparisonTable(results) {
  const tbody = document.querySelector('#comparison-table tbody');
  if (!tbody) return;

  if (!results || Object.values(results).every(r => r === null)) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:#888; text-align:center; padding:20px">Click "Compare All" to compute all 4 modes</td></tr>';
    return;
  }

  const allStates = new Set();
  Object.values(results).forEach(modeResults => {
    if (modeResults) {
      Object.keys(modeResults).forEach(id => allStates.add(id));
    }
  });

  const rows = [];
  allStates.forEach(stateId => {
    const values = MODES.map(m => {
      const modeResults = results[m.key];
      return modeResults ? (modeResults[stateId] || 0) : null;
    });

    const validValues = values.filter(v => v !== null);

    const maxVal = Math.max(...validValues.filter(v => v > 0), 0);

    rows.push({
      stateId,
      values,
      maxVal
    });
  });

  rows.sort((a, b) => b.maxVal - a.maxVal);
  const topRows = rows.slice(0, 15);

  const format = (v) => v === null ? '-' : (v * 100).toFixed(1) + '%';
  const colorFor = (v) => {
    if (v === null || v === 0) return '';
    if (v > 0.3) return 'background:#ffe0e0;';  // High = red-ish
    if (v > 0.1) return 'background:#fff3e0;';  // Medium = orange-ish
    return 'background:#e8f5e9;';               // Low = green-ish
  };

  tbody.innerHTML = topRows.map(r => {
    return `
      <tr class="comparison-row" data-state="${r.stateId}" style="cursor:pointer" title="Click to highlight in graph">
        <td style="font-weight:bold">S${r.stateId}</td>
        ${r.values.map((v, i) => `<td style="text-align:right; ${colorFor(v)}">${format(v)}</td>`).join('')}
      </tr>
    `;
  }).join('');

  document.querySelectorAll('.comparison-row').forEach(row => {
    row.addEventListener('click', () => {
      const stateId = row.dataset.state;
      highlightStateInGraph(stateId);
    });
  });
}

function highlightStateInGraph(stateId) {
  const panes = getPanes();
  Object.values(panes).forEach(pane => {
    if (!pane.cy) return;

    const cy = pane.cy;
    
    // Try to find node by ID
    let node = cy.$(`node[id="${stateId}"]`);
    
    // Also try with 's' prefix (some graphs use s0, s1, etc.)
    if (node.empty()) {
      node = cy.$(`node[id="s${stateId}"]`);
    }
    
    if (node.length > 0) {
      cy.nodes().unselect();
      node.select();
      
      cy.animate({
        center: { eles: node },
        duration: 300
      });
    }
  });
}

export function getComparisonResults() {
  return comparisonResults;
}

export function clearComparison() {
  comparisonResults = {
    'shapley-optimistic': null,
    'shapley-pessimistic': null,
    'banzhaf-optimistic': null,
    'banzhaf-pessimistic': null
  };
  stateIdToGraphId = null;
  isComputing = false;
  currentModeIndex = 0;

  renderComparisonTable(null);
  
  const statusSpan = document.getElementById('comparison-status');
  if (statusSpan) {
    statusSpan.style.display = 'none';
  }
}

// Normalize state name to canonical "val;val;val" format for matching.
function normalizeStateName(name) {
  if (!name) return name;
  let inner = name;
  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.slice(1, -1);
  }
  const parts = inner.split(/[,;]/).map(p => {
    p = p.trim();
    const eq = p.indexOf('=');
    return eq >= 0 ? p.substring(eq + 1).trim() : p;
  });
  return parts.join(';');
}

// Maps tool state IDs -> graph node IDs via normalized name matching
function buildStateIdToGraphIdMapping(stateIdToName) {
  const mapping = {};
  const panes = getPanes();
  
  const nameToGraphId = new Map();
  
  Object.values(panes).forEach(pane => {
    if (!pane.cy) return;
    pane.cy.nodes('.s').forEach(node => {
      const name = node.data('name');
      if (name) {
        nameToGraphId.set(name, node.id());
        const normalized = normalizeStateName(name);
        nameToGraphId.set(normalized, node.id());
      }
    });
  });
  
  let mapped = 0, fallback = 0;
  Object.entries(stateIdToName).forEach(([toolStateId, stateName]) => {
    let graphId = nameToGraphId.get(stateName);
    if (!graphId) {
      graphId = nameToGraphId.get(normalizeStateName(stateName));
    }
    if (graphId) {
      mapping[toolStateId] = graphId;
      mapped++;
    } else {
      mapping[toolStateId] = toolStateId;
      fallback++;
    }
  });
  
  if (fallback > 0 && mapped === 0) {
    console.warn(`[comparison] State name mapping failed for all ${fallback} states. ` +
      `Tool names and graph names may use different formats.`);
  }
  
  return mapping;
}

function mapStateIdsToGraphIds(stateResponsibility) {
  if (!stateIdToGraphId) {
    return stateResponsibility;
  }
  
  const mapped = {};
  Object.entries(stateResponsibility).forEach(([toolStateId, value]) => {
    const graphId = stateIdToGraphId[toolStateId] || toolStateId;
    mapped[graphId] = value;
  });
  
  return mapped;
}

export function exportComparisonCSV() {
  if (Object.values(comparisonResults).every(r => r === null)) {
    alert('No comparison data to export. Run "Compare All" first.');
    return;
  }

  const allStates = new Set();
  Object.values(comparisonResults).forEach(modeResults => {
    if (modeResults) {
      Object.keys(modeResults).forEach(id => allStates.add(id));
    }
  });

  let csv = 'State,Shapley-Optimistic,Shapley-Pessimistic,Banzhaf-Optimistic,Banzhaf-Pessimistic\n';
  
  [...allStates].sort((a, b) => Number(a) - Number(b)).forEach(stateId => {
    const values = MODES.map(m => {
      const r = comparisonResults[m.key];
      return r ? (r[stateId] || 0) : 0;
    });
    
    csv += `${stateId},${values.join(',')}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'responsibility_comparison.csv';
  a.click();
  URL.revokeObjectURL(url);
}
