import events from '../../utils/events.js';
import { resizeSplit } from './panes.js';
import PureContextMenu from '/libs/pure-context-menu/pure-context-menu.js';

function makeCtxMenu(bar, div, pane) {
  const items = [
    {
      label: 'Maximize Graph',
      callback: () => {
        resizeSplit(div, div.parentElement.clientHeight);
      },
    },
    {
      label: 'Resize to 70% graph, 30% PCP',
      callback: () => {
        resizeSplit(div, div.parentElement.clientHeight * 0.7);
      },
    },
    {
      label: 'Resize to 50% graph, 50% PCP',
      callback: () => {
        resizeSplit(div, div.parentElement.clientHeight * 0.5);
      },
    },
    {
      label: 'Resize to 30% graph, 70% PCP',
      callback: () => {
        resizeSplit(div, div.parentElement.clientHeight * 0.3);
      },
    },
    {
      label: 'Maximize PCP',
      callback: () => {
        resizeSplit(div, 0);
      },
    },
  ];

  return new PureContextMenu(document.body, items, {
    show: (e, inst) => {
      if (e.target.id === bar.id) {
        inst.setItems(items);
        return true;
      }
      return false;
    },
  });
};

export default makeCtxMenu;
