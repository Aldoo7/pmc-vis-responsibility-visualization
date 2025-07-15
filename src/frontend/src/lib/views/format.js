import { info } from '../main/main.js';

function ndl_to_pcp(data, prop) {
  const returnable = { pl: [], pld: {} }; // polylines, polyline data

  returnable.pl = data.nodes.map((d) => {
    const polyline = {
      id: d.id,
      _color: d.type === 's' ? '--pcp-primary' : '--pcp-secondary',
      _selected: d._selected,
    };

    Object.keys(prop).forEach((p) => {
      if (!info.types[p].includes(d.type)) return;

      Object.keys(prop[p].props).forEach((e) => {
        if (prop[p].props[e]) {
          polyline[e] = d.details[p][e];
          returnable.pld[e] ||= {
            type: prop[p].metadata[e].type,
            min: prop[p].metadata[e].min,
            max: prop[p].metadata[e].max,
            prop: p,
          };
        }
      });
    });

    return polyline;
  });

  return returnable;
}

export { ndl_to_pcp };
