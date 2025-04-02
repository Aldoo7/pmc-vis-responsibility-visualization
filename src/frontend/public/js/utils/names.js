const CONSTANTS = {
  results: 'Model Checking Results',
  atomicPropositions: 'Atomic Propositions',
  variables: 'Variable Values',

  ap_init: 'init',
  ap_deadlock: 'deadlock',
  ap_end: 'finished',

  metadata: 'metadata',

  STATUS: {
    ready: 'ready',
    computing: 'computing',
    missing: 'missing',
  },

  MESSAGES: {
    cleared_starts_with: 'Cleared database for',
    all_finished: 'All tasks finished',
  },

  INTERACTIONS: {
    expand1: {
      name: 'Expand Once',
      icon: 'fa-solid fa-angle-right',
      description: 'Expands children of selected node(s)',
      keyboard: 'Enter',
      keyboard_pane: 'Ctrl+Enter',
    },
    expandN: {
      name: 'Expand N',
      icon: 'fa-solid fa-angles-right',
      description: 'Expands n levels from the selected node(s)',
      keyboard: 'Shift+Enter', // not implemented
      keyboard_pane: 'Shift+Ctrl+Enter', // not implemented
    },
    mark: {
      name: 'Mark/Unmark Node(s)',
      icon: 'fa-regular fa-bookmark',
      description: 'Marks nodes for safekeeping (e.g., strategy)',
      keyboard: 'Ctrl+M',
    },
    // ctrl+z: undo
    // ctrl+y: redo
    // ctrl+a: select all nodes
    // ctrl+i: select initial states
    // ctrl+d: select deadlock states
    // ctrl+e: select end states

    // ideas:
    // ctrl+n: new (empty) pane
    // ctrl+c: copy selection
    // ctrl+v: paste seletion (careful with duplicates)
  },
};

export { CONSTANTS };
