import { controls } from './general.js';

// see all @ https://github.com/cytoscape/cytoscape.js-dagre

const params = {
  name: 'dagre',

  animate: true,
  animationDuration: 500,
  fit: false,

  rankDir: 'LR',
  ranker: 'longest-path',
  rankSep: 20,
  nodeSep: 10, // the separation between adjacent nodes in the same rank
  edgeSep: 50,
  align: 'UL',

  // not in controls
  padding: 30,
  nodeDimensionsIncludeLabels: true,

  controls: [
    ...controls,
    {
      label: 'Ranker Algorithm',
      param: 'ranker',
      options: [
        { value: 'network-simplex', name: 'Network Simplex' },
        { value: 'tight-tree', name: 'Tight Tree' },
        { value: 'longest-path', name: 'Longest Path' },
      ],
      type: 'dropdown',
    },
    {
      label: 'Alignment',
      param: 'align',
      options: [
        { value: 'UL', name: 'Up-Left' },
        { value: 'UR', name: 'Up-Right' },
        { value: 'DL', name: 'Down-Left' },
        { value: 'DR', name: 'Down-Right' },
      ],
      type: 'dropdown',
    },
    {
      label: 'Node Separation (within rank)',
      param: 'nodeSep',
      min: 1,
      max: 500,
      type: 'slider',
    },

    {
      label: 'Edge Separation (within rank)',
      param: 'edgeSep',
      min: 1,
      max: 500,
      type: 'slider',
    },
    {
      label: 'Rank Separation',
      param: 'rankSep',
      min: 10,
      max: 500,
      type: 'slider',
    },
    {
      label: 'Rank Direction',
      param: 'rankDir',
      options: [{ value: 'TB', name: 'Top to Bottom' }, { value: 'LR', name: 'Left to Right' }],
      type: 'dropdown',
    },
  ],
};

export { params };
