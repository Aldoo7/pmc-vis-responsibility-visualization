/**
 * Explanation Panel for High-Responsibility Nodes
 * 
 * When a user clicks a high-responsibility node in the graph,
 * this module populates a collapsible panel explaining WHY
 * the state scored highly, including:
 *   - Ranking among all states
 *   - Structural context (on trace, branching, neighbors)
 *   - Cross-mode comparison (if Compare All was run)
 *   - Variable values
 *   - Theoretical insight heuristic
 */

import { getPanes } from '../panes/panes.js';
import { getComparisonResults } from './comparison.js';

// Cache: the latest stateResponsibility map sent by the backend
let cachedStateResponsibility = null;
// Cache: the latest stateMetadata from the backend
let cachedStateMetadata = null;
// Cache: the latest counterexample (trace) from the backend
let cachedCounterexample = null;
// Cache: responsibilityType and powerIndex used
let cachedConfig = { type: null, index: null };

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Called from responsibility-controls.js whenever new results arrive
 * so we can cache data for later explanation lookups.
 */
export function cacheResponsibilityData(data) {
  if (data.stateResponsibility)  cachedStateResponsibility = data.stateResponsibility;
  if (data.stateMetadata)        cachedStateMetadata = data.stateMetadata;
  if (data.counterexample)       cachedCounterexample = data.counterexample;
  if (data.responsibilityType)   cachedConfig.type = data.responsibilityType;
  if (data.powerIndex)           cachedConfig.index = data.powerIndex;
}

/**
 * Open the explanation panel for a specific graph node.
 * @param {object} nodeOrId  Cytoscape node object, or a string node ID
 * @param {object} cy        The Cytoscape core instance the node lives in
 */
export function showExplanation(nodeOrId, cy) {
  const node = (typeof nodeOrId === 'string')
    ? cy.$('#' + nodeOrId)
    : nodeOrId;

  if (!node || node.empty()) return;

  const panel = document.getElementById('explanation-panel');
  const body  = document.getElementById('explanation-body');
  if (!panel || !body) return;

  const html = buildExplanationHTML(node, cy);
  body.innerHTML = html;
  panel.open = true;                       // expand the <details>
  panel.style.display = '';                // make sure it's visible
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Hide / clear the explanation panel.
 */
export function hideExplanation() {
  const panel = document.getElementById('explanation-panel');
  if (panel) panel.open = false;
}

/**
 * Reset cached data (e.g. when user presses Clear).
 */
export function clearExplanationCache() {
  cachedStateResponsibility = null;
  cachedStateMetadata = null;
  cachedCounterexample = null;
  cachedConfig = { type: null, index: null };
  hideExplanation();
}

/* ------------------------------------------------------------------ */
/*  HTML builder                                                      */
/* ------------------------------------------------------------------ */

function buildExplanationHTML(node, cy) {
  const nodeId   = node.id();
  const nodeName = node.data('name') || nodeId;
  const resp     = node.data('responsibility');

  const sections = [];

  // ---- Header ----
  sections.push(headerSection(nodeName, resp));

  // ---- 1. Ranking ----
  sections.push(rankingSection(nodeId, resp));

  // ---- 2. Structural context ----
  sections.push(structuralSection(node, cy, nodeId));

  // ---- 3. Variable values ----
  sections.push(variablesSection(node));

  // ---- 4. Cross-mode comparison ----
  sections.push(comparisonSection(nodeId));

  // ---- 5. Theoretical insight ----
  sections.push(insightSection(node, cy, nodeId, resp));

  return sections.join('');
}

/* ---------- individual sections ---------- */

function headerSection(name, resp) {
  const pct = resp != null ? (resp * 100).toFixed(2) : '?';
  const badge = badgeFor(resp);
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
      <span style="font-weight:700; font-size:1.05em; color:#333">${esc(name)}</span>
      <span style="font-size:1.1em; font-weight:bold">${pct}% ${badge}</span>
    </div>`;
}

function rankingSection(nodeId, resp) {
  if (!cachedStateResponsibility) return '';

  const entries = Object.entries(cachedStateResponsibility)
    .map(([id, v]) => ({ id, v: Number(v) }))
    .filter(e => !isNaN(e.v))
    .sort((a, b) => b.v - a.v);

  const total     = entries.length;
  const positives = entries.filter(e => e.v > 0);
  // Find this state (try both nodeId and all entries that match)
  const rank = entries.findIndex(e => matchId(e.id, nodeId)) + 1;

  if (rank === 0) {
    return sectionWrap('Ranking', `<span style="color:#888">State not found in cached responsibility data</span>`);
  }

  const percentile = ((1 - (rank - 1) / total) * 100).toFixed(1);
  const sumAll     = entries.reduce((s, e) => s + e.v, 0);
  const shareOfTotal = sumAll > 0 ? ((resp / sumAll) * 100).toFixed(2) : '0';

  // Gap to next
  let gapHtml = '';
  if (rank > 1) {
    const prev = entries[rank - 2];
    const gap  = (prev.v - resp);
    gapHtml = `<li>Gap from #${rank - 1}: <b>${(gap * 100).toFixed(2)} pp</b> below</li>`;
  }
  if (rank < total) {
    const next = entries[rank];
    const gap  = (resp - next.v);
    gapHtml += `<li>Gap to #${rank + 1}: <b>${(gap * 100).toFixed(2)} pp</b> above</li>`;
  }

  return sectionWrap('Ranking', `
    <ul style="margin:0; padding-left:18px; line-height:1.7">
      <li><b>#${rank}</b> out of ${total} states ${rank === 1 ? '⭐' : ''}</li>
      <li>Top <b>${percentile}%</b> percentile</li>
      <li>Accounts for <b>${shareOfTotal}%</b> of total responsibility</li>
      ${gapHtml}
    </ul>`);
}

function structuralSection(node, cy, nodeId) {
  const items = [];

  // On counterexample trace?
  const meta = cachedStateMetadata && cachedStateMetadata[nodeId];
  if (cachedCounterexample && cachedCounterexample.length > 0) {
    const onTrace = cachedCounterexample.includes(nodeId)
      || cachedCounterexample.includes('s' + nodeId)
      || (meta && meta.onTrace);
    items.push(`<li>${onTrace ? '✅' : '❌'} On counterexample trace</li>`);
  } else if (meta && meta.onTrace != null) {
    items.push(`<li>${meta.onTrace ? '✅' : '❌'} On counterexample trace</li>`);
  }

  // Can win alone? (optimistic)
  if (meta && meta.canWinAlone != null) {
    items.push(`<li>${meta.canWinAlone ? '✅' : '❌'} Can win alone (optimistic)</li>`);
  }

  // Branching degree
  const outEdges = node.outgoers('edge');
  const inEdges  = node.incomers('edge');
  items.push(`<li>Outgoing transitions: <b>${outEdges.length}</b></li>`);
  items.push(`<li>Incoming transitions: <b>${inEdges.length}</b></li>`);

  // Neighbor list (limit to 8)
  const successors = outEdges.map(e => e.target()).filter(n => n.id() !== node.id());
  if (successors.length > 0) {
    const names = successors.slice(0, 8).map(n => n.data('name') || n.id());
    const more  = successors.length > 8 ? ` (+${successors.length - 8} more)` : '';
    items.push(`<li>Successors: ${names.map(n => `<code>${esc(n)}</code>`).join(', ')}${more}</li>`);
  }

  // Edge labels (actions)
  const actionLabels = [...new Set(outEdges.map(e => e.data('label')).filter(Boolean))];
  if (actionLabels.length > 0) {
    items.push(`<li>Actions: ${actionLabels.map(l => `<code>${esc(l)}</code>`).join(', ')}</li>`);
  }

  if (items.length === 0) return '';
  return sectionWrap('Structural Context', `<ul style="margin:0; padding-left:18px; line-height:1.7">${items.join('')}</ul>`);
}

function variablesSection(node) {
  const details = node.data('details');
  if (!details) return '';

  // "Variable Values" is the standard key used by the backend
  const vars = details['Variable Values'];
  if (!vars || Object.keys(vars).length === 0) return '';

  const rows = Object.entries(vars).map(([k, v]) =>
    `<tr><td style="padding:2px 8px; color:#555">${esc(k)}</td><td style="padding:2px 8px; font-weight:600">${esc(String(v))}</td></tr>`
  ).join('');

  return sectionWrap('Variable Values', `
    <table style="width:100%; font-size:0.9em; border-collapse:collapse">
      ${rows}
    </table>`);
}

function comparisonSection(nodeId) {
  const compResults = getComparisonResults();
  if (!compResults) return '';

  const hasData = Object.values(compResults).some(m => m !== null);
  if (!hasData) return '';

  // Try to find this nodeId across all modes
  const modes = [
    { key: 'shapley-optimistic',  label: 'Shapley-Opt' },
    { key: 'shapley-pessimistic', label: 'Shapley-Pes' },
    { key: 'banzhaf-optimistic',  label: 'Banzhaf-Opt' },
    { key: 'banzhaf-pessimistic', label: 'Banzhaf-Pes' },
  ];

  const values = modes.map(m => {
    const modeMap = compResults[m.key];
    if (!modeMap) return null;
    // Try direct match, then with 's' prefix
    let val = modeMap[nodeId];
    if (val == null) val = modeMap['s' + nodeId];
    // Try all keys
    if (val == null) {
      for (const [k, v] of Object.entries(modeMap)) {
        if (matchId(k, nodeId)) { val = v; break; }
      }
    }
    return val != null ? Number(val) : null;
  });

  if (values.every(v => v === null)) return '';

  // Find max
  let maxIdx = -1;
  let maxVal = -1;
  values.forEach((v, i) => { if (v != null && v > maxVal) { maxVal = v; maxIdx = i; } });

  const headerRow = `<tr><th></th><th style="text-align:right; color:#1976d2; padding:4px 8px">Optimistic</th><th style="text-align:right; color:#e65100; padding:4px 8px">Pessimistic</th></tr>`;

  function cell(val, idx) {
    if (val === null) return '<td style="text-align:right; padding:4px 8px; color:#ccc">—</td>';
    const bold = idx === maxIdx ? 'font-weight:bold; color:#c62828;' : '';
    return `<td style="text-align:right; padding:4px 8px; ${bold}">${(val * 100).toFixed(2)}%</td>`;
  }

  const shapleyRow = `<tr><td style="padding:4px 8px; font-weight:600">Shapley</td>${cell(values[0], 0)}${cell(values[1], 1)}</tr>`;
  const banzhafRow = `<tr><td style="padding:4px 8px; font-weight:600">Banzhaf</td>${cell(values[2], 2)}${cell(values[3], 3)}</tr>`;

  const highestNote = maxIdx >= 0
    ? `<p style="margin:6px 0 0; font-size:0.85em; color:#555">Highest under <b>${modes[maxIdx].label}</b></p>`
    : '';

  return sectionWrap('Cross-Mode Comparison', `
    <table style="width:100%; font-size:0.9em; border-collapse:collapse; border:1px solid #eee; border-radius:4px">
      ${headerRow}${shapleyRow}${banzhafRow}
    </table>
    ${highestNote}`);
}

function insightSection(node, cy, nodeId, resp) {
  if (resp == null || resp <= 0) return '';

  const reasons = [];

  // On trace?
  const meta = cachedStateMetadata && cachedStateMetadata[nodeId];
  const onTrace = (cachedCounterexample && (
    cachedCounterexample.includes(nodeId) ||
    cachedCounterexample.includes('s' + nodeId)
  )) || (meta && meta.onTrace);

  if (onTrace) reasons.push('it lies on the counterexample trace');

  // High branching?
  const outDeg = node.outgoers('edge').length;
  if (outDeg >= 3) reasons.push(`it has high branching (${outDeg} outgoing transitions), making it pivotal in many coalitions`);
  else if (outDeg >= 2) reasons.push(`it has ${outDeg} outgoing transitions (nondeterministic choice)`);

  // Is it the highest?
  if (cachedStateResponsibility) {
    const entries = Object.entries(cachedStateResponsibility)
      .map(([id, v]) => ({ id, v: Number(v) }))
      .sort((a, b) => b.v - a.v);
    const rank = entries.findIndex(e => matchId(e.id, nodeId)) + 1;
    if (rank === 1) reasons.push('it has the single highest responsibility value among all states');
  }

  // Consistent across modes?
  const compResults = getComparisonResults();
  if (compResults) {
    const allVals = Object.values(compResults)
      .filter(m => m !== null)
      .map(m => {
        for (const [k, v] of Object.entries(m)) {
          if (matchId(k, nodeId)) return Number(v);
        }
        return null;
      })
      .filter(v => v !== null);

    if (allVals.length >= 2 && allVals.every(v => v > 0.5)) {
      reasons.push('it scores highly (>50%) across all computed modes, indicating robust responsibility');
    }
  }

  // Config context
  const modeStr = cachedConfig.type ? cachedConfig.type : 'unknown';
  const indexStr = cachedConfig.index ? cachedConfig.index : 'unknown';

  if (reasons.length === 0) {
    return sectionWrap('Theoretical Insight', `
      <p style="margin:0; font-size:0.9em; color:#555">
        Under the <b>${modeStr}</b> interpretation with <b>${indexStr}</b> index,
        this state received a high responsibility value. Inspect its neighbors and
        transitions to understand its role in the counterexample.
      </p>`);
  }

  const reasonsStr = reasons.map((r, i) => {
    if (i === 0) return r;
    if (i === reasons.length - 1) return 'and ' + r;
    return r;
  }).join(', ');

  return sectionWrap('Theoretical Insight', `
    <p style="margin:0; font-size:0.9em; color:#555">
      Under the <b>${modeStr}</b> interpretation with <b>${indexStr}</b> index,
      this state has high responsibility because ${reasonsStr}.
    </p>
    <p style="margin:6px 0 0; font-size:0.82em; color:#888">
      The Shapley value aggregates over all possible coalitions. A state's responsibility
      reflects how often adding it to a coalition turns a "safe" scenario into one that
      reaches the error — i.e., the number and weight of its switching pairs.
    </p>`);
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

function sectionWrap(title, content) {
  return `
    <div style="margin-bottom:12px">
      <div style="font-weight:600; font-size:0.88em; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; border-bottom:1px solid #eee; padding-bottom:3px">${title}</div>
      ${content}
    </div>`;
}

function badgeFor(resp) {
  if (resp == null) return '';
  if (resp >= 0.7)  return '<span style="background:#ff6b6b; color:white; padding:2px 8px; border-radius:10px; font-size:0.8em">HIGH</span>';
  if (resp >= 0.3)  return '<span style="background:#ffa726; color:white; padding:2px 8px; border-radius:10px; font-size:0.8em">MED</span>';
  if (resp > 0)     return '<span style="background:#66bb6a; color:white; padding:2px 8px; border-radius:10px; font-size:0.8em">LOW</span>';
  return '';
}

/**
 * Fuzzy match: numeric IDs from the tool may be "3", graph IDs may be "s3", etc.
 */
function matchId(a, b) {
  if (a === b) return true;
  if ('s' + a === b || a === 's' + b) return true;
  // strip leading 's' from both
  const na = a.replace(/^s/, '');
  const nb = b.replace(/^s/, '');
  return na === nb;
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
