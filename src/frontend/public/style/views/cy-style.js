import { badges } from './badges.js';

const colors = {
  NODE_COLOR: '#555',
  DARK_TEXT: '#555',
  LIGHT_TEXT: '#fff',

  SELECTED_BORDER: '#4887b9',

  RECURRING: '#4da3ff',
  SECONDARY_NODE_COLOR: '#afafaf',
  CENTRAL_NODE_COLOR: '#E5C07B',
  SELECTED_NODE_COLOR: '#4887b9',
  SECONDARY_SELECTION: '#ee8c31',
  DUAL_SELECTION: '#a4c35d',

  EDGE_COLOR: '#dadada',
  HL_EDGE_COLOR: '#b8b8b8',
  EDGE_LABEL_COLOR: '#b3b3b3',
};

const outlines = {
  width_selected: 10,
  width: 2,
};

const selections = {
  primary: {
    'border-color': colors.SELECTED_BORDER,
    'border-width': outlines.width_selected,
    'border-style': 'double',
    'border-position': 'center',
    // opacity: 1,
  },
  secondary: {
    width: '10px',
    height: '10px',
    'border-color': colors.SECONDARY_SELECTION,
    'border-width': outlines.width_selected,
    'border-style': 'solid',
    'border-position': 'center',
    // opacity: 1,
  },
};

const stylesheet = [
  {
    selector: 'core',
    style: {
      'selection-box-color': colors.SELECTED_NODE_COLOR,
      'selection-box-border-color': '#8BB0D0',
      'selection-box-opacity': '0.5',
    },
  },
  {
    selector: 'node.s',
    style: {
      label: 'data(id)',
      color: colors.LIGHT_TEXT,
      shape: 'rectangle',
      height: 20,
      width: 50,
      'font-size': 10,
      'font-family': 'monospace',
      'text-valign': 'center',
      'text-margin-y': '0.65px',
      'text-halign': 'center',
      'background-color': colors.NODE_COLOR,
      'text-outline-color': colors.NODE_COLOR,
      'text-outline-width': '2px',
      'overlay-padding': '6px',
      'z-index': '10',
      'background-opacity': 1,
      'border-width': outlines.width,
      'border-color': colors.NODE_COLOR,
      'text-outline-opacity': 0,
      'bounds-expansion': '20px',
    },
  },
  {
    selector: 'node.s.marked',
    style: {
      'background-image': '/style/icons/badge-green.svg',
      'background-image-containment': 'over',
      'background-clip': 'none',
      'background-height': badges.height,
      'background-width': badges.width,
      'background-position-x': badges.x,
      'background-position-y': badges.y,
    },
  },
  {
    selector: 'node.s.marked:selected',
    style: {
      'background-position-y': badges.y_s,
    },
  },
  {
    selector: 'node.t',
    style: {
      height: '5px',
      width: '5px',
      shape: 'ellipse',
      'background-color': colors.SECONDARY_NODE_COLOR,
    },
  },
  {
    selector: 'node.s[[outdegree > 0]]', // expanded node
    style: {
      color: colors.DARK_TEXT,
      'background-opacity': 0,
      'border-color': colors.NODE_COLOR,
    },
  },
  {
    selector: 'node.s:selected',
    style: selections.primary,
  },
  {
    selector: 'node.t:selected',
    style: selections.secondary,
  },
  {
    selector: 'node.recurring',
    style: {
      'background-opacity': 1,
      'background-color': colors.RECURRING,
      'border-color': colors.RECURRING,
    },
  },
  {
    selector: 'edge',
    style: {
      label: 'data(label)',
      color: colors.NODE_COLOR,
      width: 1.5,
      'font-size': 8,
      'curve-style': 'bezier', // taxi
      'target-arrow-shape': 'triangle',
      'line-color': colors.EDGE_COLOR,
      'target-arrow-color': colors.EDGE_COLOR,
      'line-style': 'dashed',
      'line-dash-pattern': [6, 3],
      'line-dash-offset': 24,
    },
  },
  {
    selector: 'edge.scheduler',
    style: {
      'line-color': colors.HL_EDGE_COLOR,
      'target-arrow-color': colors.HL_EDGE_COLOR,
      'line-style': 'solid',
    },
  },
];

const overviewStylesheet = [
  {
    selector: 'core',
    style: {
      'selection-box-color': colors.SELECTED_NODE_COLOR,
      'selection-box-border-color': '#8BB0D0',
      'selection-box-opacity': '0.5',
    },
  },
  {
    selector: 'node.active-pane',
    style: {
      'border-color': '#439843',
      'border-width': '1px',
      'border-style': 'solid',
    },
  },
  {
    selector: 'node:selected',
    style: selections.primary,
  },
  {
    selector: 'edge',
    style: {
      label: 'data(label)',
      color: colors.NODE_COLOR,
      width: 1.5,
      'font-size': 8,
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      'line-color': colors.EDGE_COLOR,
      'target-arrow-color': colors.EDGE_COLOR,
      'line-style': 'dashed',
      'line-dash-pattern': [6, 3],
      'line-dash-offset': 24,
    },
  },
];

export {
  stylesheet, colors, selections, overviewStylesheet,
};
