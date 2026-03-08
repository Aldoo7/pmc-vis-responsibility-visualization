import { socket } from '../imports/import-socket.js';
import { getPanes } from '../panes/panes.js';
import { PROJECT } from '../../utils/controls.js';
import { initFilteringControls, updateStateResponsibility, clearFiltering } from './filtering.js';
import { initComparisonControls, clearComparison, exportComparisonCSV } from './comparison.js';

let isRunning = false;
let isPaused = false;
let lastComponentResponsibility = null;
let lastStateResponsibility = null;
let lastGroupingMode = null;
let lastSwitchingPairs = null;
let lastSwitchingPairStats = null; // Per-player stats from full Shapley computation
let lastStateIdToName = null; // Raw state ID → human name mapping

function getActiveProjectId() {
  const el = document.getElementById('project-id');
  const uiId = el && el.textContent ? el.textContent.trim() : '';
  return uiId || PROJECT;
}

let controlsInitialized = false;

export function initResponsibilityControls() {
  if (controlsInitialized) {
    return;
  }
  controlsInitialized = true;

  const startBtn = document.getElementById('resp-start');
  const cancelBtn = document.getElementById('resp-cancel');
  const clearBtn = document.getElementById('resp-clear');
  const statusDiv = document.getElementById('resp-status');
  const statusText = document.getElementById('resp-status-text');

  loadSavedConfig();
  initFilteringControls();
  initComparisonControls();
  
  const exportCsvBtn = document.getElementById('export-comparison-csv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportComparisonCSV);
  }

  // toggle sampling input based on checkbox
  const useSamplingCheckbox = document.getElementById('resp-use-sampling');
  const samplingConfigInput = document.getElementById('resp-sampling-config');
  if (useSamplingCheckbox && samplingConfigInput) {
    useSamplingCheckbox.addEventListener('change', () => {
      samplingConfigInput.disabled = !useSamplingCheckbox.checked;
      if (useSamplingCheckbox.checked && !samplingConfigInput.value) {
        samplingConfigInput.value = '10000'; // sensible default
      }
    });
  }

  startBtn.addEventListener('click', () => {
    const mode = document.getElementById('resp-mode').value;
    const powerIndex = document.getElementById('resp-power-index').value;
    
    const useSampling = document.getElementById('resp-use-sampling')?.checked || false;
    const samplingInput = document.getElementById('resp-sampling-config')?.value || '';
    const groupingMode = document.getElementById('resp-grouping-mode')?.value || 'individual';

    saveConfig();

    const payload = {
      modelFile: 'current',
      property: 'current',
      targetLevel: 1,
      mode: mode,
      powerIndex: powerIndex,
      counterexample: null,
      projectId: getActiveProjectId(),
      samplingConfig: useSampling && samplingInput ? samplingInput : null,
      groupingMode: groupingMode !== 'individual' ? groupingMode : null
    };

    socket.emit('responsibility:start', payload);

    isRunning = true;
    isPaused = false;
    updateButtonStates();
    statusDiv.style.display = 'block';
    statusText.textContent = useSampling ? 'Running (sampling)...' : 'Running...';
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

  // Copy button
  const copyBtn = document.getElementById('copy-state-resp-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copyStateResponsibilityToClipboard();
    });
  }

  socket.on('responsibility:status', (data) => {
    const state = data.state || data.status;
    const message = data.message || state;
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

  socket.on('responsibility:result', (_data) => {
    if (_data && _data.stateResponsibility) {
      lastStateResponsibility = _data.stateResponsibility;
      
      // Store switching pairs if present (from switching pair analysis)
      if (_data.switchingPairs && _data.switchingPairs.length > 0) {
        lastSwitchingPairs = _data.switchingPairs;
      }
      // Store real switching pair stats from Java Shapley computation
      if (_data.switchingPairStats) {
        lastSwitchingPairStats = _data.switchingPairStats;
      }
      // Store state ID to name mapping for resolving coalition member names
      if (_data.stateIdToName) {
        lastStateIdToName = _data.stateIdToName;
      }
      
      if (_data.groupedMode && _data.groups) {
        lastGroupingMode = _data.groupingMode || 'group';
        renderGroupResponsibilityTable(_data.groups, _data.groupingMode);
      } else {
        lastGroupingMode = null;
        updateStateResponsibility(_data.stateResponsibility);
        renderStateResponsibilityTable(_data.stateResponsibility);
      }
      
      // Show approximate/grouped indicator
      const statusText = document.getElementById('resp-status-text');
      if (statusText && _data.approximate) {
        const samplingInfo = _data.samplingConfig ? ` (${_data.samplingConfig})` : '';
        statusText.textContent = `Completed (approx${samplingInfo})`;
        statusText.style.color = '#e67e22';
      } else if (statusText && _data.groupedMode) {
        const groupInfo = _data.groupingMode ? ` by ${_data.groupingMode}` : '';
        statusText.textContent = `Completed (grouped${groupInfo})`;
        statusText.style.color = '#3498db';
      } else if (statusText) {
        statusText.style.color = '';
      }
    }
    
    // Defer so graph updater can set node responsibility first
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
        node.removeClass('resp-high resp-medium resp-low sp-coalition-member sp-pivot-state');
      });
      pane.cy.endBatch();
    }
  });

  lastComponentResponsibility = null;
  const tbody = document.querySelector('#component-resp-table tbody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#888; text-align:center">No data yet</td></tr>';
  }
  
  lastStateResponsibility = null;
  lastSwitchingPairs = null;
  lastSwitchingPairStats = null;
  lastStateIdToName = null;
  const stateTbody = document.querySelector('#state-resp-table tbody');
  if (stateTbody) {
    stateTbody.innerHTML = '<tr><td colspan="4" style="color:#888; text-align:center">No data yet</td></tr>';
  }
}

function saveConfig() {
  localStorage.setItem('resp_mode', document.getElementById('resp-mode').value);
  localStorage.setItem('resp_powerIndex', document.getElementById('resp-power-index').value);
  
  const useSampling = document.getElementById('resp-use-sampling');
  const samplingConfig = document.getElementById('resp-sampling-config');
  const groupingMode = document.getElementById('resp-grouping-mode');
  if (useSampling) localStorage.setItem('resp_useSampling', useSampling.checked);
  if (samplingConfig) localStorage.setItem('resp_samplingConfig', samplingConfig.value);
  if (groupingMode) localStorage.setItem('resp_groupingMode', groupingMode.value);
}

function loadSavedConfig() {
  const mode = localStorage.getItem('resp_mode');
  const powerIndex = localStorage.getItem('resp_powerIndex');

  if (mode) document.getElementById('resp-mode').value = mode;
  if (powerIndex) document.getElementById('resp-power-index').value = powerIndex;
  
  const useSampling = localStorage.getItem('resp_useSampling');
  const samplingConfig = localStorage.getItem('resp_samplingConfig');
  const groupingMode = localStorage.getItem('resp_groupingMode');
  
  const useSamplingCheckbox = document.getElementById('resp-use-sampling');
  const samplingConfigInput = document.getElementById('resp-sampling-config');
  const groupingModeSelect = document.getElementById('resp-grouping-mode');
  
  if (useSamplingCheckbox && useSampling === 'true') {
    useSamplingCheckbox.checked = true;
    if (samplingConfigInput) samplingConfigInput.disabled = false;
  }
  if (samplingConfigInput && samplingConfig) {
    samplingConfigInput.value = samplingConfig;
  }
  if (groupingModeSelect && groupingMode) {
    groupingModeSelect.value = groupingMode;
  }
}

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
    result[k] = s / c;
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

  const rows = Object.entries(componentMap)
    .map(([name, value]) => ({ name, value: Number(value) }))
    .sort((a, b) => b.value - a.value);

  const max = rows[0].value || 1;

  const format = (v) => (v * 100).toFixed(2) + '%';
  const colorFor = (v) => {
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

function renderGroupResponsibilityTable(groups, groupingMode) {
  const tbody = document.querySelector('#state-resp-table tbody');
  if (!tbody) return;

  if (!groups || Object.keys(groups).length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#888; text-align:center">No group data</td></tr>';
    return;
  }

  // Build rows from groups map: { groupName: { responsibility: 0.xxx, members: [...] } }
  const rows = Object.entries(groups)
    .map(([name, info]) => ({
      name,
      value: Number(info.responsibility || 0),
      members: info.members || []
    }))
    .filter(r => !isNaN(r.value))
    .sort((a, b) => b.value - a.value);

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const modeLabel = (groupingMode || 'group').charAt(0).toUpperCase() + (groupingMode || 'group').slice(1);

  const positives = rows.filter(r => r.value > 0);
  const highCutoff = Math.max(1, Math.ceil(positives.length * 0.3));
  const medCutoff = Math.max(highCutoff + 1, Math.ceil(positives.length * 0.7));

  // Update header to show group mode
  const tableHeader = document.querySelector('#state-resp-table thead tr');
  if (tableHeader) {
    const firstTh = tableHeader.querySelector('th');
    if (firstTh) firstTh.textContent = `${modeLabel} Group`;
  }

  tbody.innerHTML = rows.map((r, idx) => {
    const percentage = total > 0 ? ((r.value / total) * 100).toFixed(2) : '0.00';
    const valueStr = r.value.toFixed(8);

    let colorClass = '';
    let badge = '';
    if (r.value > 0) {
      const posIdx = positives.findIndex(p => p.name === r.name);
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

    const displayName = escapeHtml(r.name);

    return `
      <tr style="${colorClass}">
        <td>${displayName}${badge}</td>
        <td style="text-align:right">${valueStr}</td>
        <td style="text-align:right">${percentage}%</td>
      </tr>
    `;
  }).join('');

  lastStateResponsibility = {};
  rows.forEach(r => { lastStateResponsibility[r.name] = r.value; });
}

function renderStateResponsibilityTable(stateResponsibilityMap) {
  const tbody = document.querySelector('#state-resp-table tbody');
  if (!tbody) return;

  // Reset header back to "State" in case it was in group mode
  const tableHeader = document.querySelector('#state-resp-table thead tr');
  if (tableHeader) {
    const firstTh = tableHeader.querySelector('th');
    if (firstTh) firstTh.textContent = 'State';
  }

  if (!stateResponsibilityMap || Object.keys(stateResponsibilityMap).length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:#888; text-align:center">No data yet</td></tr>';
    return;
  }

  const rows = Object.entries(stateResponsibilityMap)
    .map(([stateId, value]) => ({ stateId, value: Number(value) }))
    .filter(r => !isNaN(r.value))
    .sort((a, b) => b.value - a.value);

  const top10 = rows.slice(0, 10);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const positives = rows.filter(r => r.value > 0);
  const highCutoff = Math.max(1, Math.ceil(positives.length * 0.3));
  const medCutoff = Math.max(highCutoff + 1, Math.ceil(positives.length * 0.7));

  tbody.innerHTML = top10.map((r, idx) => {
    const percentage = total > 0 ? ((r.value / total) * 100).toFixed(2) : '0.00';
    const valueStr = r.value.toFixed(8);
    
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
    
    const stateLabel = resolveStateShortLabel(r.stateId);

    // Switching pairs column — only show if we have real data
    const spStats = lastSwitchingPairStats ? lastSwitchingPairStats[r.stateId] : null;
    let pivotCell = '<td style="text-align:center; color:#bbb">—</td>';
    
    if (spStats) {
      const pct = spStats.totalCoalitions > 0 
          ? Math.round(100 * spStats.pivotalCount / spStats.totalCoalitions) : 0;
      let bg, color;
      if (spStats.pivotalCount === 0) {
        bg = 'transparent'; color = '#888';
      } else if (pct >= 50) {
        bg = '#c0392b'; color = 'white';
      } else if (pct >= 20) {
        bg = '#e67e22'; color = 'white';
      } else {
        bg = '#27ae60'; color = 'white';
      }
      const style = bg === 'transparent' 
          ? `color:${color}; font-size:10px`
          : `background:${bg}; color:${color}; padding:2px 6px; border-radius:3px; font-size:10px; font-weight:600; cursor:pointer`;
      pivotCell = `<td style="text-align:center; cursor:pointer" class="pivot-cell" data-state-id="${r.stateId}">` +
          `<span style="${style}">${spStats.pivotalCount}/${spStats.totalCoalitions}</span></td>`;
    }
    
    return `
      <tr style="${colorClass}" data-state-id="${r.stateId}">
        <td>${stateLabel}${badge}</td>
        <td style="text-align:right">${valueStr}</td>
        <td style="text-align:right">${percentage}%</td>
        ${pivotCell}
      </tr>
    `;
  }).join('');

  // Attach click handlers for switching pair detail expansion
  tbody.querySelectorAll('.pivot-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      const sid = cell.dataset.stateId;
      const existingDetail = tbody.querySelector(`tr.pivot-detail-row[data-for="${sid}"]`);
      if (existingDetail) {
        existingDetail.remove();
        clearCoalitionHighlight();
        return;
      }
      // Remove any other open detail rows
      tbody.querySelectorAll('tr.pivot-detail-row').forEach(r => r.remove());
      clearCoalitionHighlight();
      
      const spStats = lastSwitchingPairStats ? lastSwitchingPairStats[sid] : null;
      if (!spStats) return;

      const pct = spStats.totalCoalitions > 0 
          ? Math.round(100 * spStats.pivotalCount / spStats.totalCoalitions) : 0;
      
      let html = '<td colspan="4" style="padding:8px 10px; background:#f8f9fa; border-left:3px solid #3498db">';
      html += `<div style="display:flex; justify-content:space-between; align-items:center">`;
      html += `<strong style="font-size:0.9em">Switching pairs for State ${escapeHtml(sid)}</strong>`;
      html += `<span style="font-size:0.8em; color:#666">Pivotal in ${spStats.pivotalCount} of ${spStats.totalCoalitions} coalitions (${pct}%)</span>`;
      html += `</div>`;
      
      // Example coalitions — clickable to highlight on graph
      if (spStats.examples && spStats.examples.length > 0) {
        html += `<div style="margin-top:6px; font-size:0.82em; color:#555">Click a coalition to highlight its members on the graph:</div>`;
        html += `<div style="margin-top:4px">`;
        spStats.examples.forEach((coalition, i) => {
          const memberNames = coalition.map(id => {
            const full = resolveStateName(id);
            const short = /^\d+$/.test(id) ? `State ${id}` : id;
            if (full !== short) {
              return `<span title="${escapeHtml(full)}" style="cursor:help; border-bottom:1px dotted #999">${escapeHtml(short)}</span>`;
            }
            return escapeHtml(short);
          });
          const cStr = coalition.length === 0 
              ? '<span style="color:#888">∅</span> <span style="color:#666">(wins alone)</span>' 
              : '{' + memberNames.join(', ') + '}';
          // Store raw IDs as data attribute for graph interaction
          const rawIds = coalition.join(',');
          html += `<div class="sp-coalition-entry" data-member-ids="${rawIds}" data-pivot-id="${sid}" style="
            margin:3px 0; padding:4px 8px; font-family:monospace; font-size:0.92em;
            background:#fff; border:1px solid #ddd; border-radius:4px;
            cursor:pointer; transition:all 0.15s; display:flex; align-items:center; gap:6px;
          ">`;
          html += `<span style="color:#3498db; font-size:1.1em">&#9654;</span>`;
          html += `<span>C = ${cStr}</span>`;
          html += `</div>`;
        });
        if (spStats.pivotalCount > spStats.examples.length) {
          html += `<div style="margin:4px 0; font-size:0.78em; color:#999; font-style:italic; padding-left:8px">`;
          html += `… and ${spStats.pivotalCount - spStats.examples.length} more`;
          html += `</div>`;
        }
        html += `</div>`;
      } else if (spStats.pivotalCount === 0) {
        html += `<div style="margin-top:4px; font-size:0.82em; color:#888; font-style:italic">Not pivotal in any coalition.</div>`;
      }
      
      html += '</td>';
      const detailRow = document.createElement('tr');
      detailRow.className = 'pivot-detail-row';
      detailRow.dataset.for = sid;
      detailRow.innerHTML = html;
      cell.closest('tr').after(detailRow);

      // Attach click handlers to coalition entries
      detailRow.querySelectorAll('.sp-coalition-entry').forEach(entry => {
        entry.addEventListener('mouseenter', () => { 
          entry.style.background = '#e3f2fd'; 
          entry.style.borderColor = '#3498db'; 
        });
        entry.addEventListener('mouseleave', () => { 
          entry.style.background = '#fff'; 
          entry.style.borderColor = '#ddd'; 
        });
        entry.addEventListener('click', () => {
          const memberIds = entry.dataset.memberIds ? entry.dataset.memberIds.split(',').filter(Boolean) : [];
          const pivotId = entry.dataset.pivotId;
          highlightCoalitionOnGraph(memberIds, pivotId);
          // Mark active entry
          detailRow.querySelectorAll('.sp-coalition-entry').forEach(e => {
            e.style.background = '#fff';
            e.style.borderColor = '#ddd';
          });
          entry.style.background = '#d4edfa'; 
          entry.style.borderColor = '#2980b9';
        });
      });
    });
  });
  
  lastStateResponsibility = stateResponsibilityMap;
}

/** Resolve a raw state ID to a human-readable name using the stateIdToName map */
function resolveStateName(stateId) {
  if (lastStateIdToName && lastStateIdToName[stateId]) {
    return lastStateIdToName[stateId];
  }
  return /^\d+$/.test(stateId) ? `State ${stateId}` : stateId;
}

/** Short label for table display — just "State N" with full name as tooltip */
function resolveStateShortLabel(stateId) {
  const fullName = resolveStateName(stateId);
  const short = /^\d+$/.test(stateId) ? `State ${stateId}` : stateId;
  if (fullName !== short) {
    return `<span title="${escapeHtml(fullName)}" style="cursor:help; border-bottom:1px dotted #999">${short}</span>`;
  }
  return short;
}

/** Highlight coalition members + pivot state on the Cytoscape graph */
function highlightCoalitionOnGraph(memberIds, pivotId) {
  const panes = getPanes();
  Object.values(panes).forEach(pane => {
    if (!pane.cy) return;
    const cy = pane.cy;
    
    // Clear previous coalition highlights
    cy.$('node.s').removeClass('sp-coalition-member sp-pivot-state');
    
    // Build lookup maps for flexible node resolution
    const idToNode = new Map();
    cy.$('node.s').forEach(node => {
      const nid = node.id();
      const name = node.data('name');
      const label = node.data('label');
      idToNode.set(nid, node);
      if (name) {
        idToNode.set(name, node);
        if (name.startsWith('s')) idToNode.set(name.substring(1), node);
      }
      if (label) {
        idToNode.set(label, node);
        if (label.startsWith('s')) idToNode.set(label.substring(1), node);
      }
    });

    const resolveNode = (stateId) => {
      let node = idToNode.get(String(stateId));
      if (!node) node = idToNode.get('s' + stateId);
      if (!node && lastStateIdToName && lastStateIdToName[stateId]) {
        node = idToNode.get(lastStateIdToName[stateId]);
      }
      return node || null;
    };
    
    // Highlight coalition members in blue
    const highlightedNodes = [];
    memberIds.forEach(id => {
      const node = resolveNode(id);
      if (node) {
        node.addClass('sp-coalition-member');
        highlightedNodes.push(node);
      }
    });
    
    // Highlight the pivot state (the one being added) in orange
    if (pivotId) {
      const pivotNode = resolveNode(pivotId);
      if (pivotNode) {
        pivotNode.addClass('sp-pivot-state');
        highlightedNodes.push(pivotNode);
      }
    }
    
    // Pan to show all highlighted nodes
    if (highlightedNodes.length > 0) {
      const collection = cy.collection(highlightedNodes);
      cy.animate({
        fit: { eles: collection, padding: 60 },
        duration: 400
      });
    }
  });
}

/** Clear coalition highlights from the graph */
function clearCoalitionHighlight() {
  const panes = getPanes();
  Object.values(panes).forEach(pane => {
    if (!pane.cy) return;
    pane.cy.$('node.s').removeClass('sp-coalition-member sp-pivot-state');
  });
}

function copyStateResponsibilityToClipboard() {
  if (!lastStateResponsibility || Object.keys(lastStateResponsibility).length === 0) {
    alert('No responsibility data available to copy');
    return;
  }

  const isGrouped = lastGroupingMode != null;
  const modeLabel = isGrouped 
    ? lastGroupingMode.charAt(0).toUpperCase() + lastGroupingMode.slice(1)
    : 'State';
  const itemLabel = isGrouped ? 'groups' : 'states';

  // Get the analysis settings that were used
  const modeEl = document.getElementById('resp-mode');
  const powerIndexEl = document.getElementById('resp-power-index');
  const mode = modeEl ? modeEl.options[modeEl.selectedIndex].text : 'Unknown';
  const powerIndex = powerIndexEl ? powerIndexEl.options[powerIndexEl.selectedIndex].text : 'Unknown';

  const groupingEl = document.getElementById('resp-grouping-mode');
  const grouping = groupingEl ? groupingEl.options[groupingEl.selectedIndex].text : null;
  const useSampling = document.getElementById('resp-use-sampling')?.checked || false;
  const samplingConfig = document.getElementById('resp-sampling-config')?.value || '';

  const rows = Object.entries(lastStateResponsibility)
    .map(([stateId, value]) => ({ stateId, value: Number(value) }))
    .filter(r => !isNaN(r.value))
    .sort((a, b) => b.value - a.value);

  const total = rows.reduce((sum, r) => sum + r.value, 0);

  let text = `${modeLabel} Responsibility Values\n`;
  text += '='.repeat(50) + '\n';
  text += `Analysis: ${powerIndex} × ${mode}\n`;
  if (grouping && grouping.toLowerCase() !== 'individual') {
    text += `Grouping: ${grouping}\n`;
  }
  if (useSampling) {
    text += `Sampling: ${samplingConfig || 'enabled'}\n`;
  }
  text += '='.repeat(50) + '\n\n';
  text += `${modeLabel}\tValue\t\t% of Total\n`;
  text += '-'.repeat(50) + '\n';

  rows.forEach(r => {
    const percentage = total > 0 ? ((r.value / total) * 100).toFixed(2) : '0.00';
    const valueStr = r.value.toFixed(8);
    text += `${r.stateId}\t${valueStr}\t${percentage}%\n`;
  });

  text += '\n' + '='.repeat(50) + '\n';
  text += `Total: ${rows.length} ${itemLabel}\n`;
  text += `Sum: ${total.toFixed(8)}\n`;

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
