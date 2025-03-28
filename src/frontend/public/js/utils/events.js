const events = {
  RESIZE_ALL: new CustomEvent('paneResize', {
    detail: {
      pane: 'all',
    },
  }),
  GLOBAL_PROPAGATE: new CustomEvent('global-action', {
    detail: {
      action: 'propagate',
    },
  }),
  RESIZE_ONE: (one) => new CustomEvent('paneResize', {
    detail: {
      pane: one,
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
