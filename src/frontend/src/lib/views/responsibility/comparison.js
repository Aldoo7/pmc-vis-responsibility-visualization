/**
 * Mode Comparison Feature
 * 
 * Computes and displays responsibility values across all 4 modes:
 * - Shapley + Optimistic
 * - Shapley + Pessimistic
 * - Banzhaf + Optimistic
 * - Banzhaf + Pessimistic
 * 
 * Shows a comparison table to identify states with high responsibility.
 */

import { socket } from '../imports/import-socket.js';
import { getPanes } from '../panes/panes.js';
import { PROJECT } from '../../utils/controls.js';

// Store results from all 4 modes
let comparisonResults = {
  'shapley-optimistic': null,
  'shapley-pessimistic': null,
  'banzhaf-optimistic': null,
  'banzhaf-pessimistic': null
};

// Store state ID to graph node ID mapping (from first response)
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

/**
 * Initialize comparison controls
 */
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

/**
 * Start computing all 4 modes sequentially
 */
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

  // Clear previous results
  renderComparisonTable(null);
  computeNextMode();
}

/**
 * Compute the next mode in sequence
 */
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

/**
 * Handle result from backend
 */
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

/**
 * Handle status events from backend (used to detect completion)
 */
function handleComparisonStatus(data) {
  if (!isComputing) return;

  const status = data?.status || data?.state || '';
  
  if (status === 'completed') {
    currentModeIndex++;
    setTimeout(() => computeNextMode(), 300);
  }
}

/**
 * Finish comparison and render results
 */
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

  // Render comparison table
  renderComparisonTable(comparisonResults);
}

/**
 * Render the comparison table
 */
function renderComparisonTable(results) {
  const tbody = document.querySelector('#comparison-table tbody');
  if (!tbody) return;

  if (!results || Object.values(results).every(r => r === null)) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:#888; text-align:center; padding:20px">Click "Compare All" to compute all 4 modes</td></tr>';
    return;
  }

  // Collect all unique state IDs
  const allStates = new Set();
  Object.values(results).forEach(modeResults => {
    if (modeResults) {
      Object.keys(modeResults).forEach(id => allStates.add(id));
    }
  });

  // Build rows
  const rows = [];
  allStates.forEach(stateId => {
    const values = MODES.map(m => {
      const modeResults = results[m.key];
      return modeResults ? (modeResults[stateId] || 0) : null;
    });

    const validValues = values.filter(v => v !== null);

    // Max value across modes (for sorting)
    const maxVal = Math.max(...validValues.filter(v => v > 0), 0);

    rows.push({
      stateId,
      values,
      maxVal
    });
  });

  // Sort by max value descending
  rows.sort((a, b) => b.maxVal - a.maxVal);

  // Take top 15
  const topRows = rows.slice(0, 15);

  // Render
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

  // Add click handlers for row selection
  document.querySelectorAll('.comparison-row').forEach(row => {
    row.addEventListener('click', () => {
      const stateId = row.dataset.state;
      highlightStateInGraph(stateId);
    });
  });
}

/**
 * Highlight a state in all graph panes
 */
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
      // Deselect all, then select this one
      cy.nodes().unselect();
      node.select();
      
      // Center view on this node
      cy.animate({
        center: { eles: node },
        duration: 300
      });
    }
  });
}

/**
 * Clear comparison results
 */
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

/**
 * Build mapping from state ID (from responsibility tool) to graph node ID.
 * The stateIdToName from backend maps: toolStateId -> stateName (variable assignment string)
 * We need to find graph nodes whose 'name' matches these state names.
 */
function buildStateIdToGraphIdMapping(stateIdToName) {
  const mapping = {};
  const panes = getPanes();
  
  // Build a lookup from state name to graph node ID
  const nameToGraphId = new Map();
  
  Object.values(panes).forEach(pane => {
    if (!pane.cy) return;
    pane.cy.nodes('.s').forEach(node => {
      const name = node.data('name');
      if (name) {
        nameToGraphId.set(name, node.id());
      }
    });
  });
  
  // Map each tool state ID to graph node ID via the name
  Object.entries(stateIdToName).forEach(([toolStateId, stateName]) => {
    const graphId = nameToGraphId.get(stateName);
    if (graphId) {
      mapping[toolStateId] = graphId;
    } else {
      // Fallback: use tool state ID directly
      mapping[toolStateId] = toolStateId;
    }
  });
  
  return mapping;
}

/**
 * Map responsibility results from tool state IDs to graph node IDs.
 */
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

/**
 * Export comparison data as CSV
 */
export function exportComparisonCSV() {
  if (Object.values(comparisonResults).every(r => r === null)) {
    alert('No comparison data to export. Run "Compare All" first.');
    return;
  }

  // Collect all states
  const allStates = new Set();
  Object.values(comparisonResults).forEach(modeResults => {
    if (modeResults) {
      Object.keys(modeResults).forEach(id => allStates.add(id));
    }
  });

  // Build CSV
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
