import { controls } from './general.js';

// see more @ https://github.com/cytoscape/cytoscape.js-elk
const params = {
  name: 'elk',

  animate: true,
  animationDuration: 500,
  fit: true,

  elk: {
    // see http://www.eclipse.org/elk/reference.html
    algorithm: 'layered',
    'elk.direction': 'RIGHT',
  },

  // not in controls
  padding: 30,
  nodeDimensionsIncludeLabels: true,

  controls: [
    ...controls,
    {
      label: 'ELK algorithm',
      param: 'elk',
      subParam: 'algorithm',
      options: [
        { value: 'layered', name: 'Layered' },
        { value: 'mrtree', name: 'Mr. Tree' },

        { value: 'box', name: 'Box' },
        { value: 'disco', name: 'DisCo' },
        { value: 'fixed', name: 'Fixed' },
        { value: 'force', name: 'Force' },
        { value: 'radial', name: 'Radial' },
        { value: 'rectpacking', name: 'Rectangle Packing' },
        { value: 'sporeCompaction', name: 'SPOrE Compaction' },
        { value: 'sporeOverlap', name: 'SPOrE Overlap Removal' },
        { value: 'stress', name: 'Stress' },

        // not implemented
        // { value: "conn.gmf.layouter.Draw2D", name: "Draw2D Layout"},
        // { value: "graphviz.circo", name: "Graphviz Circo"},
        // { value: "graphviz.dot", name: "Graphviz Dot"},
        // { value: "graphviz.fdp", name: "Graphviz FDP"},
        // { value: "graphviz.neato", name: "Graphviz Neato"},
        // { value: "graphviz.twopi", name: "Grahpviz Twopi"},
        // { value: "alg.libavoid", name: "Libavoid"},
        // { value: "topdownpacking", name: "Top-Down Packing"},
      ],
      type: 'dropdown',
    },
    {
      label: 'Flow direction',
      param: 'elk',
      // elk.elk.direction would not work because elk in 'elk.direction' is not an object
      subParam: 'elk.direction',
      options: [{ value: 'DOWN', name: 'Down' }, { value: 'RIGHT', name: 'Right' }],
      type: 'dropdown',
    },
  ],
};

export { params };
