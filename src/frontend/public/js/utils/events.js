const events = {
  GLOBAL_PROPAGATE: new CustomEvent('global-action', {
    detail: {
      action: 'propagate',
    },
  }),
  GLOBAL_MARK: (elements) => new CustomEvent('global-action', {
    detail: {
      action: 'mark',
      type: '',
      elements,
    },
  }),
  GLOBAL_UNMARK: (elements) => new CustomEvent('global-action', {
    detail: {
      action: 'mark',
      type: 'undo-',
      elements,
    },
  }),
  LINKED_SELECTION: (pane, selection) => new CustomEvent('linked-selection', {
    detail: {
      pane,
      selection,
    },
  }),
};

export default events;
