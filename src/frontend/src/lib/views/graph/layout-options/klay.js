import { controls } from './general.js';

// see all @ https://github.com/cytoscape/cytoscape.js-klay

const params = {
  name: 'klay',
  animate: true,
  animationDuration: 500,
  fit: true,

  klay: {
    direction: 'UNDEFINED',
    edgeSpacingFactor: 0.8,
    edgeRouting: 'SPLINES',
    compactComponents: false,
    // feedbackEdges: true,
    fixedAlignment: 'NONE',
    nodeLayering: 'NETWORK_SIMPLEX',
    nodePlacement: 'BRANDES_KOEPF',
  },

  // not in controls
  padding: 30,
  nodeDimensionsIncludeLabels: true,

  controls: [
    ...controls,
    {
      label: 'Edge Direction',
      param: 'klay',
      subParam: 'direction',
      options: [
        { value: 'UNDEFINED', name: 'Free' },
        { value: 'RIGHT', name: 'Right' },
        { value: 'LEFT', name: 'Left' },
        { value: 'UP', name: 'Up' },
        { value: 'DOWN', name: 'Down' },
      ],
      type: 'dropdown',
    },
    {
      label: 'Edge Spacing Factor',
      param: 'klay',
      subParam: 'edgeSpacingFactor',
      min: 0.0,
      step: 0.2,
      max: 5,
      type: 'slider',
    },
    {
      label: 'Edge Routing',
      param: 'klay',
      subParam: 'edgeRouting',
      options: [
        { value: 'POLYLINE', name: 'Polyline' },
        { value: 'ORTHOGONAL', name: 'Orthogonal' },
        { value: 'SPLINES', name: 'Splines' },
      ],
      type: 'dropdown',
    },
    {
      label: 'Alignment',
      param: 'klay',
      subParam: 'fixedAlignment',
      options: [
        { value: 'NONE', name: 'Smallest' },
        { value: 'BALANCED', name: 'Balanced' },
        { value: 'LEFTUP', name: 'Up-Left' },
        { value: 'RIGHTUP', name: 'Up-Right' },
        { value: 'LEFTDOWN', name: 'Left-Down' },
        { value: 'RIGHTDOWN', name: 'Right-Down' },
      ],
      type: 'dropdown',
    },
    {
      label: 'Nodes Layering',
      param: 'klay',
      subParam: 'nodeLayering',
      options: [
        { value: 'NETWORK_SIMPLEX', name: 'Network Simplex' },
        { value: 'LONGEST_PATH', name: 'Longest Path' },
        { value: 'INTERACTIVE', name: 'Interactive' },
      ],
      type: 'dropdown',
    },
    {
      label: 'Nodes Placement Strategy',
      param: 'klay',
      subParam: 'nodePlacement',
      options: [
        { value: 'BRANDES_KOEPF', name: 'Brandes-Köpf' },
        { value: 'LINEAR_SEGMENTS', name: 'Linear Segments' },
        { value: 'INTERACTIVE', name: 'Interactive' },
        { value: 'SIMPLE', name: 'Smallest area' },
      ],
      type: 'dropdown',
    },
    {
      label: 'Compact Dangling Components',
      param: 'klay',
      subParam: 'compactComponents',
      affects: {},
      type: 'toggle',
    },
  ],
};

export { params };
