/**
 * Responsibility-based state filtering
 * Allows filtering graph nodes by responsibility threshold
 */

import { getPanes } from '../panes/panes.js';

let currentThreshold = 0;
let lastStateResponsibility = null;

/**
 * Initialize filtering controls
 */
export function initFilteringControls() {
  const thresholdSlider = document.getElementById('resp-threshold');
  const thresholdValueSpan = document.getElementById('resp-threshold-value');

  if (!thresholdSlider || !thresholdValueSpan) {
    return;
  }

  // Update threshold display
  thresholdSlider.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    thresholdValueSpan.textContent = `${value}%`;
    currentThreshold = value / 100;
  });

  // Apply filter when slider is released
  thresholdSlider.addEventListener('change', (e) => {
    const value = parseInt(e.target.value);
    currentThreshold = value / 100;
    applyResponsibilityFilter();
  });
}

/**
 * Store state responsibility data from backend
 */
export function updateStateResponsibility(stateRespMap) {
  lastStateResponsibility = stateRespMap;
}

/**
 * Apply responsibility-based filtering to graph
 */
function applyResponsibilityFilter() {
  if (!lastStateResponsibility) return;

  const panes = getPanes();
  let totalFiltered = 0;

  Object.values(panes).forEach(pane => {
    if (!pane.cy) return;

    const cy = pane.cy;
    cy.startBatch();

    // Clear previous filtering
    cy.$('node, edge').removeClass('filtered-out');

    // Get all state nodes
    const stateNodes = cy.$('node.s');
    
    stateNodes.forEach(node => {
      const responsibility = node.data('responsibility');
      
      if (responsibility !== undefined) {
        if (responsibility >= currentThreshold) {
          node.removeClass('filtered-out');
          totalFiltered++;
        } else {
          node.addClass('filtered-out');
        }
      } else {
        if (currentThreshold > 0) {
          node.addClass('filtered-out');
        }
      }
    });

    // Dim edges connected to dimmed nodes
    cy.edges().forEach(edge => {
      const source = edge.source();
      const target = edge.target();
      
      if (source.hasClass('filtered-out') || target.hasClass('filtered-out')) {
        edge.addClass('filtered-out');
      } else {
        edge.removeClass('filtered-out');
      }
    });

    cy.endBatch();
  });

  updateFilterStats(totalFiltered);
}

/**
 * Update filter statistics display
 */
function updateFilterStats(filteredCount) {
  const statsDiv = document.getElementById('filter-stats');
  const filteredSpan = document.getElementById('filtered-count');

  if (!statsDiv) return;

  if (currentThreshold > 0) {
    statsDiv.style.display = 'block';
    if (filteredSpan) {
      filteredSpan.textContent = filteredCount;
    }
  } else {
    statsDiv.style.display = 'none';
  }
}

/**
 * Clear all filtering
 */
export function clearFiltering() {
  const panes = getPanes();
  
  Object.values(panes).forEach(pane => {
    if (!pane.cy) return;
    
    const cy = pane.cy;
    cy.startBatch();
    cy.$('node, edge').removeClass('filtered-out');
    cy.endBatch();
  });

  currentThreshold = 0;
  
  const thresholdSlider = document.getElementById('resp-threshold');
  const thresholdValueSpan = document.getElementById('resp-threshold-value');
  
  if (thresholdSlider) thresholdSlider.value = 0;
  if (thresholdValueSpan) thresholdValueSpan.textContent = '0%';
  
  updateFilterStats(0);
}
