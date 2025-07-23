import cytoscape from 'cytoscape';

import cola from 'cytoscape-cola';
cytoscape.use(cola);

// import elk from 'cytoscape-elk';
// cytoscape.use(elk);

import dagre from 'cytoscape-dagre';
cytoscape.use(dagre);

import klay from 'cytoscape-klay';
cytoscape.use(klay);

import undoRedo from 'cytoscape-undo-redo';
cytoscape.use(undoRedo);

import contextMenus from 'cytoscape-context-menus';
cytoscape.use(contextMenus);

import nodeHtmlLabel from 'cytoscape-node-html-label';
cytoscape.use(nodeHtmlLabel);

import layoutUtilities from 'cytoscape-layout-utilities';
cytoscape.use(layoutUtilities);

import cytoscapePopper from 'cytoscape-popper';
cytoscape.use(cytoscapePopper);

export { cytoscape };
