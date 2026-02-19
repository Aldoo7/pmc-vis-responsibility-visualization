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

  // Gap from #1 (most responsible) and gap above next below
  let gapHtml = '';
  if (rank > 1) {
    const top = entries[0];
    const gapFromTop = (top.v - resp);
    gapHtml = `<li>Gap from #1: <b>${(gapFromTop * 100).toFixed(2)} pp</b> below top</li>`;
  }
  if (rank < total) {
    const next = entries[rank];
    const gapAboveNext = (resp - next.v);
    gapHtml += `<li>Gap above #${rank + 1}: <b>${(gapAboveNext * 100).toFixed(2)} pp</b> ahead</li>`;
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

  const outEdges = node.outgoers('edge');
  const outDeg   = outEdges.length;
  const inEdges  = node.incomers('edge');
  const inDeg    = inEdges.length;
  const modeStr  = cachedConfig.type  || 'unknown';
  const indexStr = cachedConfig.index || 'unknown';
  const isOpt    = modeStr.toLowerCase().includes('optimistic');
  const isPes    = modeStr.toLowerCase().includes('pessimistic');
  const isShapley = indexStr.toLowerCase().includes('shapley');

  const findings = [];   // data-driven bullet points
  let mainReason = '';    // one-sentence summary

  // ---- 1. Decision point / successor analysis ----
  const successors = outEdges.map(e => e.target()).filter(n => n.id() !== node.id());
  const succResps = successors.map(n => {
    const r = n.data('responsibility');
    return r != null ? Number(r) : null;
  }).filter(r => r !== null);

  if (succResps.length > 0) {
    const minSucc = Math.min(...succResps);
    const maxSucc = Math.max(...succResps);
    const avgSucc = succResps.reduce((a, b) => a + b, 0) / succResps.length;

    // "Direct route to safety" — a successor with near-zero resp means this state
    // could have diverted. Baier: states on winning strategies can redirect play away from error.
    const safeExits = succResps.filter(r => r < 0.01);
    if (safeExits.length > 0 && resp > 0.1) {
      findings.push(`<b>Direct route to safety:</b> ${safeExits.length} of ${succResps.length} successor(s) have near-zero responsibility. This state sits at a branching point where choosing differently could have avoided the error entirely.`);
      mainReason = 'it has a direct exit toward a safe region of the model—choosing the alternative action here would have prevented the error';
    }

    // "Point of no return" — high resp AND all successors also high → past the
    // decision point, now on an inevitable path to the error.
    if (succResps.length > 0 && minSucc > resp * 0.6 && resp > 0.1) {
      findings.push(`<b>Point of no return:</b> All successors also carry high responsibility (min ${(minSucc * 100).toFixed(1)}%). Once the system reaches this state, the error is nearly inevitable regardless of future choices.`);
      if (!mainReason) mainReason = 'it lies past the critical decision point—all downstream paths lead toward the error';
    }

    // "Decision point" — responsibility drops sharply to successors
    if (resp > avgSucc * 2 && avgSucc < resp * 0.5) {
      findings.push(`<b>Decision point:</b> Responsibility drops from ${(resp * 100).toFixed(1)}% here to avg ${(avgSucc * 100).toFixed(1)}% in successors. The pivotal choice between reaching the error or avoiding it happens at this state.`);
      if (!mainReason) mainReason = 'the critical choice between reaching the error or avoiding it happens at this state';
    }
  }

  // ---- 2. No choice = no blame (Baier: single-transition states have zero resp) ----
  if (outDeg === 1 && resp < 0.01) {
    findings.push(`<b>No choice, no blame:</b> This state has only 1 outgoing transition. With no alternative action available, it cannot change the outcome and correctly receives zero responsibility.`);
    mainReason = 'it has only one transition—without an alternative path, it has no power to change the outcome';
  } else if (outDeg === 1 && resp > 0.01) {
    findings.push(`<b>Bottleneck state:</b> This state has only 1 outgoing transition but nonzero responsibility (${(resp * 100).toFixed(1)}%). It acts as a routing bottleneck—other states\' ability to divert the system depends on whether they can bypass this state.`);
    if (!mainReason) mainReason = 'despite having only one transition, it acts as a structural bottleneck that other states must route through';
  }

  // ---- 3. Gateway state detection ----
  // A state where responsibility drops sharply compared to its predecessors
  // indicates a "gateway" — the last point of intervention before a high-responsibility zone.
  const predecessors = inEdges.map(e => e.source()).filter(n => n.id() !== node.id());
  const predResps = predecessors.map(n => {
    const r = n.data('responsibility');
    return r != null ? Number(r) : null;
  }).filter(r => r !== null);

  if (predResps.length > 0 && resp > 0.15) {
    const avgPred = predResps.reduce((a, b) => a + b, 0) / predResps.length;
    if (resp > avgPred * 2.5 && avgPred < 0.1) {
      findings.push(`<b>Gateway state:</b> Predecessors have low responsibility (avg ${(avgPred * 100).toFixed(1)}%) while this state jumps to ${(resp * 100).toFixed(1)}%. This is a boundary state—entering it marks the transition from a safe region into a high-responsibility zone.`);
      if (!mainReason) mainReason = 'it is a gateway between a low-responsibility region and the error-prone zone of the model';
    }
  }

  // ---- 4. Equal-share detection (optimistic mode property) ----
  // Baier Theorem: In optimistic mode, all states in the optimal winning strategy set
  // receive equal responsibility = 1/|WS_opt|. So equal top values = equally pivotal.
  if (isOpt && cachedStateResponsibility) {
    const entries = Object.entries(cachedStateResponsibility)
      .map(([id, v]) => ({ id, v: Number(v) }))
      .filter(e => !isNaN(e.v) && e.v > 0)
      .sort((a, b) => b.v - a.v);

    if (entries.length >= 2) {
      const topVal = entries[0].v;
      const sameAsTop = entries.filter(e => Math.abs(e.v - topVal) < 0.001);
      if (sameAsTop.length >= 2 && sameAsTop.some(e => matchId(e.id, nodeId))) {
        // Check if value is close to 1/n (the theoretical equal share)
        const theoreticalShare = 1 / sameAsTop.length;
        const matchesTheory = Math.abs(topVal - theoreticalShare) < 0.02;

        let shareExplanation = matchesTheory
          ? `Each receives exactly 1/${sameAsTop.length} = ${(theoreticalShare * 100).toFixed(1)}%, confirming the optimistic equal-share theorem.`
          : `They share the top value of ${(topVal * 100).toFixed(1)}%.`;

        findings.push(`<b>Equal share (optimistic property):</b> ${sameAsTop.length} states share the same top responsibility. ${shareExplanation} Each of these states can independently divert the system away from the error—they form the minimal winning strategy set.`);
        if (!mainReason) mainReason = `it is one of ${sameAsTop.length} states that can each independently prevent the error, so they share responsibility equally under the optimistic interpretation`;
      }
    }
  }

  // ---- 5. Pessimistic differentiates where optimistic cannot ----
  // Baier: optimistic mode gives equal shares, but pessimistic uses adversarial
  // off-trace behavior to differentiate otherwise-equal states.
  if (isPes && cachedStateResponsibility) {
    const entries = Object.entries(cachedStateResponsibility)
      .map(([id, v]) => ({ id, v: Number(v) }))
      .filter(e => !isNaN(e.v) && e.v > 0)
      .sort((a, b) => b.v - a.v);

    if (entries.length >= 3) {
      // Check if values are well-spread (not all equal)
      const top3 = entries.slice(0, 3);
      const spread = top3[0].v - top3[2].v;
      if (spread > 0.05 && entries.some(e => matchId(e.id, nodeId) && e === entries[0])) {
        findings.push(`<b>Stands out under adversity:</b> In pessimistic mode, off-trace states act adversarially. Despite this worst-case assumption, this state still dominates the ranking—it is pivotal even when the environment works against it.`);
        if (!mainReason) mainReason = 'even under adversarial assumptions about other states, this state remains the most pivotal for reaching the error';
      }
    }
  }

  // ---- 6. Cross-mode pattern analysis ----
  const compResults = getComparisonResults();
  if (compResults) {
    const vals = {};
    for (const [modeKey, modeMap] of Object.entries(compResults)) {
      if (!modeMap) continue;
      for (const [k, v] of Object.entries(modeMap)) {
        if (matchId(k, nodeId)) { vals[modeKey] = Number(v); break; }
      }
    }

    const optS = vals['shapley-optimistic'];
    const pesS = vals['shapley-pessimistic'];
    const optB = vals['banzhaf-optimistic'];
    const pesB = vals['banzhaf-pessimistic'];

    // Robust across modes — structurally important, not assumption-dependent
    if (optS != null && pesS != null) {
      if (optS > 0.01 && pesS > 0.01 && Math.abs(optS - pesS) < 0.05) {
        findings.push(`<b>Robust across modes:</b> Shapley-Optimistic (${(optS * 100).toFixed(1)}%) ≈ Shapley-Pessimistic (${(pesS * 100).toFixed(1)}%). This state's responsibility is structurally inherent—it does not depend on assumptions about how other states behave.`);
      } else if (optS > pesS * 1.5 && optS > 0.05) {
        // Cooperation-dependent
        findings.push(`<b>Cooperation-dependent:</b> Shapley-Optimistic (${(optS * 100).toFixed(1)}%) is much higher than Pessimistic (${(pesS * 100).toFixed(1)}%). This state is most effective when other states also cooperate to avoid the error. Under adversarial conditions, its influence diminishes.`);
      } else if (pesS > optS * 1.5 && pesS > 0.05) {
        // Resilient under adversity
        findings.push(`<b>Resilient under adversity:</b> Shapley-Pessimistic (${(pesS * 100).toFixed(1)}%) exceeds Optimistic (${(optS * 100).toFixed(1)}%). Even when off-trace states act adversarially, this state remains highly pivotal—it may be the only line of defense.`);
      }
    }

    // Monotonicity gap (opt >= pes for Shapley): large gap = state needs cooperation
    if (optS != null && pesS != null && optS > pesS + 0.1) {
      const gap = ((optS - pesS) * 100).toFixed(1);
      findings.push(`<b>Monotonicity gap:</b> ${gap} pp difference between optimistic and pessimistic Shapley values. A large gap indicates this state's power depends heavily on cooperation from other states.`);
    }

    // All modes high — genuine causal significance
    const allVals = Object.values(vals).filter(v => v != null);
    if (allVals.length >= 3 && allVals.every(v => v > 0.15)) {
      if (!mainReason) mainReason = 'it consistently ranks as highly responsible across all index-mode combinations, indicating genuine causal significance for the error';
    }
  }

  // ---- 7. Nondeterministic branching (fallback only) ----
  if (findings.length === 0 && outDeg >= 2) {
    findings.push(`<b>Nondeterministic choice:</b> This state has ${outDeg} outgoing transitions, giving it the ability to influence the outcome depending on which action is chosen.`);
    if (!mainReason) mainReason = `it has ${outDeg} outgoing transitions, providing choice points where the system could have been redirected`;
  }

  // ---- Build final HTML ----
  if (!mainReason) {
    mainReason = 'it contributes to reaching the error state in the cooperative game that underlies the responsibility model';
  }

  const findingsHtml = findings.length > 0
    ? `<ul style="margin:6px 0 0; padding-left:16px; line-height:1.6; font-size:0.88em; color:#444">${findings.map(f => `<li style="margin-bottom:4px">${f}</li>`).join('')}</ul>`
    : '';

  // Brief theory footnote (varies by index and mode)
  let theoryNote = '';
  if (isShapley) {
    theoryNote = `Shapley value: averages a state's marginal contribution across all possible coalition orderings. Values sum to 1 across all states, giving a natural "share of blame."`;
  } else {
    theoryNote = `Banzhaf index: counts the fraction of coalitions where adding this state flips the outcome from "error reachable" to "error avoided." Does not sum to 1—measures raw pivotal frequency.`;
  }
  if (isOpt) {
    theoryNote += ` Optimistic mode: off-trace states are assumed to cooperate (take safe actions).`;
  } else if (isPes) {
    theoryNote += ` Pessimistic mode: off-trace states are assumed adversarial (take worst-case actions).`;
  }

  return sectionWrap('Theoretical Insight', `
    <p style="margin:0; font-size:0.9em; color:#555">
      Under the <b>${modeStr}</b> interpretation with <b>${indexStr}</b> index,
      this state has high responsibility because ${mainReason}.
    </p>
    ${findingsHtml}
    <p style="margin:8px 0 0; font-size:0.78em; color:#999; border-top:1px solid #f0f0f0; padding-top:6px">
      ${theoryNote}
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
