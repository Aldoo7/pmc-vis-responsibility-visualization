import { getPanes } from '../panes/panes.js';

let currentThreshold = 0;
let lastStateResponsibility = null;

export function initFilteringControls() {
  const thresholdSlider = document.getElementById('resp-threshold');
  const thresholdValueSpan = document.getElementById('resp-threshold-value');

  if (!thresholdSlider || !thresholdValueSpan) {
    return;
  }

  thresholdSlider.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    thresholdValueSpan.textContent = `${value}%`;
    currentThreshold = value / 100;
  });

  thresholdSlider.addEventListener('change', (e) => {
    const value = parseInt(e.target.value);
    currentThreshold = value / 100;
    applyResponsibilityFilter();
  });
}

export function updateStateResponsibility(stateRespMap) {
  lastStateResponsibility = stateRespMap;
}

function applyResponsibilityFilter() {
  if (!lastStateResponsibility) return;

  const panes = getPanes();
  let totalFiltered = 0;

  Object.values(panes).forEach(pane => {
    if (!pane.cy) return;

    const cy = pane.cy;
    cy.startBatch();

    cy.$('node, edge').removeClass('filtered-out');

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
