import events from '../../utils/events.js';
import PureContextMenu from '/libs/pure-context-menu/pure-context-menu.js';

function makeCtxMenu(divID, pane, fns, { extras }) {
  const items = [
    {
      label: 'Sync Selection in Model View',
      preventCloseOnClick: true,
      callback: () => dispatchEvent(events.LINKED_SELECTION(pane.id, fns.getSelection())),
    },
    {
      label: 'New Pane from Selection...',
      callback: () => {
        if (pane.cy.pcp) {
          pane.cy.paneFromPCP(pane);
        }
      },
    },
  ];

  return new PureContextMenu(document.body, items, {
    show: (e, inst) => {
      if (!e.target.closest('#' + divID)) {
        return false;
      }
      if (!e.axisName) {
        inst.setItems(items);
      } else {
        inst.setItems([...items, ...extras]);
      }
      return true;
    },
  });
};

export default makeCtxMenu;
