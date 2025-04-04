import { controls } from './general.js';

// see all @ https://github.com/cytoscape/cytoscape.js-cola

const params = {
  name: 'cola',

  animate: true,
  animationDuration: 500,
  fit: true,

  randomize: false,
  nodeSpacing: 5,
  edgeLength: 75,
  // edgeSymDiffLength: 2,
  // edgeJaccardLength: 2,
  centerGraph: true,
  maxSimulationTime: 1500,
  flow: {
    axis: 'x',
    minSeparation: 30,
  },

  // not in controls
  padding: 30,
  nodeDimensionsIncludeLabels: true,
  ungrabifyWhileSimulating: true,

  controls: [
    ...controls,
    {
      label: 'Center Graph',
      param: 'centerGraph',
      affects: {},
      type: 'toggle',
    },
    {
      label: 'Randomize',
      param: 'randomize',
      affects: {
        flow: null,
      },
      type: 'toggle',
    },
    {
      label: 'Max Simulation Time (ms)',
      param: 'maxSimulationTime',
      min: 1000,
      max: 10000,
      type: 'slider',
    },
    {
      label: 'Edge length',
      param: 'edgeLength',
      min: 1,
      max: 200,
      type: 'slider',
    },
    {
      label: 'Node spacing',
      param: 'nodeSpacing',
      min: 1,
      max: 50,
      type: 'slider',
    },
    {
      label: 'Flow axis',
      param: 'flow',
      subParam: 'axis',
      options: [
        { value: 'x', name: 'X' },
        { value: 'y', name: 'Y' },
        { value: null, name: 'None' },
      ],
      type: 'dropdown',
    },
    {
      label: 'Flow Separation',
      param: 'flow',
      subParam: 'minSeparation',
      min: 1,
      max: 200,
      type: 'slider',
    },
  ],
};

export { params };
