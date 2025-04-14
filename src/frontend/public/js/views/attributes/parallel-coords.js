// Adapted from: https://gist.github.com/syntagmatic/2409451 and https://gist.github.com/mbostock/1341021
// d3v7 brushing example https://observablehq.com/@d3/brushable-parallel-coordinates

import { setPane } from '../../utils/controls.js';
import events from '../../utils/events.js';
import { fixed } from '../../utils/utils.js';
import makeCtxMenu from './ctx-menu.js';
import {
  frequencies, histogram, violin,
} from './axis.js';

function parallelCoords(pane, data, metadata) {
  let counts = {};
  const selections = new Map(); // stores dimension -> brush selection
  const highlighted = new Set(); // stores hover highlighting, always a subset of selections
  let selected = {}; // stores data selection
  let extents = {}; // for preserving brushes on nominals and booleans
  let dimensions;
  let pcpHtml;
  const bounds = { min: 0, max: 1 };
  const scale = 2; // canvas resolution scale
  const stack = 5; // amount of line segments that can be stacked until full opacity

  const publicFunctions = {
    destroy: () => {
      Object.values(pcpHtml).forEach((l) => {
        const layer = document.getElementById(l);
        if (layer) {
          layer.remove();
        }
      });
      d3.selectAll('#' + pcpHtml.div).remove();
      selections.clear();
      highlighted.clear();
      selected = {};
      extents = {};
      dimensions = undefined;
      pcpHtml = undefined;
    },
    getSelection: () => {
      return Object.values(selected).map((d) => {
        const returnable = {};
        Object.keys(metadata.pld).forEach((c) => {
          returnable[c] = d[c];
        });
        returnable.id = d.id;
        return returnable;
      });
    },
    redraw: () => {
      draw(pane, data);
    },
  };

  function updateCountStrings() {
    const pcp_selection = publicFunctions.getSelection();
    const count = document.getElementById('count');
    const json = document.getElementById('json');

    if (count && json) {
      count.textContent = 'Selected elements: ' + pcp_selection.length;
      json.textContent = JSON.stringify(pcp_selection, undefined, 2);
    }
  }

  function resize(e) {
    if (
      e.detail.pane
      && (e.detail.pane === 'all' || e.detail.pane.id === pane.id)
    ) {
      draw(pane, data);
    }
  }

  function draw(pane, data) {
    function drawForeground(d, count = false) {
      foreground.strokeStyle = getComputedStyle(div).getPropertyValue(d.color);
      path(d, foreground, count);
    }

    function drawBoundIndicator(dim, selection, ctx) {
      const color = ctx.strokeStyle;
      const alpha = ctx.globalAlpha;
      const width = ctx.lineWidth;
      ctx.strokeStyle = getComputedStyle(div).getPropertyValue('--pcp-axes-lines');
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      let { x, y } = {};
      if (orient) {
        x = adjust(resp.scale(dim) + margin.left);
        y = adjust(resp.axes[dim](selection[1]) + margin.top);
      } else {
        x = adjust(resp.axes[dim](selection[0]) + margin.left);
        y = adjust(resp.scale(dim) + margin.top);
      }

      if (pane.cy.vars['pcp-bi'].value === 'o') {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.stroke();
      }

      if (pane.cy.vars['pcp-bi'].value === '><') {
        const t = 7;
        const pl = 4;
        const pr = pl + 1;

        ctx.beginPath();

        if (orient) {
          ctx.moveTo(x - t - pl, y - t);
          ctx.lineTo(x - pl, y);
          ctx.lineTo(x - t - pl, y + t);

          ctx.moveTo(x + t + pr, y - t);
          ctx.lineTo(x + pr, y);
          ctx.lineTo(x + t + pr, y + t);
        } else {
          ctx.moveTo(x - t, y - t - pl);
          ctx.lineTo(x, y - pl);
          ctx.lineTo(x + t, y - t - pl);

          ctx.moveTo(x - t, y + t + pr);
          ctx.lineTo(x, y + pr);
          ctx.lineTo(x + t, y + t + pr);
        }

        ctx.stroke();
      }

      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
    }

    // applies effect over duration
    function transition(g) {
      return g.transition().duration(500);
    }

    function checkIfActive(point) {
      return Array.from(selections).every(([key, [min, max]]) => {
        const val = metadata.pld[key].type === 'number'
          ? point[key]
          : resp.axes[key].mapping[point[key]];
        return val >= Math.min(min, max) && val <= Math.max(min, max);
      });
    }

    function getAxisId(d) {
      return pane.id + '_axis_' + d;
    }

    // returns the dimension in x/y or modified in dragging
    function position(d) {
      const v = dragging[d];
      return v === undefined ? resp.scale(d) : v;
    }

    function checkExceedsStack(line, ctx, ds) {
      const l0 = orient ? fixed(line.l0.y) : fixed(line.l0.x);
      const l1 = orient ? fixed(line.l1.y) : fixed(line.l1.x);
      ctx.stacks[ds.d0] ||= {};
      ctx.stacks[ds.d0][ds.d1] ||= {};
      ctx.stacks[ds.d0][ds.d1][l0] ||= {};
      ctx.stacks[ds.d0][ds.d1][l0][l1] ||= 0;
      ctx.stacks[ds.d0][ds.d1][l0][l1] += 1;
      return ctx.stacks[ds.d0][ds.d1][l0][l1] > ctx.stack;
    }

    function segment(line, ctx, ds) {
      if (!checkExceedsStack(line, ctx, ds)) {
        ctx.beginPath();
        ctx.moveTo(line.l0.x, line.l0.y);
        ctx.lineTo(line.l1.x, line.l1.y);
        ctx.stroke();
        ctx.segments.drawn += 1;
      } else {
        ctx.segments.skipped += 1;
      }
    }

    function adjust(v) {
      return scale * v - 1;
    }

    // returns the path for a given data point
    // this maps the generated x/y function for each of the data points to every dimension
    function path(point, ctx, count = false) {
      const lines = orient
        ? (d0, d1) => ({
          l0: {
            x: adjust(resp.scale(d0) + margin.left),
            y: adjust(resp.axes[d0](point[d0]) + margin.top),
          },
          l1: {
            x: adjust(resp.scale(d1) + margin.left),
            y: adjust(resp.axes[d1](point[d1]) + margin.top),
          },
        })
        : (d0, d1) => ({
          l0: {
            x: adjust(resp.axes[d0](point[d0]) + margin.left),
            y: adjust(resp.scale(d0) + margin.top),
          },
          l1: {
            x: adjust(resp.axes[d1](point[d1]) + margin.left),
            y: adjust(resp.scale(d1) + margin.top),
          },
        });

      dimensions.forEach((d1, i) => {
        if (i > 0) {
          const d0 = dimensions[i - 1];
          segment(lines(d0, d1), ctx, { d0, d1 });
        }
        if (count) {
          const val = fixed(resp.axes[d1](point[d1]));
          counts[d1] ||= {};
          counts[d1][val] ||= 0;
          counts[d1][val] += 1;
        }
      });
    }

    function brush_start(e) {
      e.sourceEvent.stopPropagation();
    }

    // handles a brush event, updates selections
    function brush({ selection }, key) {
      if (selection === null || selection[0] === selection[1]) {
        selections.delete(key);
      } else {
        selections.set(key, selection.map(resp.axes[key].invert));
      }

      drawBrushed();
      updateCountStrings();
      dispatchEvent(
        events.LINKED_SELECTION(pane.id, publicFunctions.getSelection()),
      );
    }

    function drawBrushed() {
      selected = {};
      [ // clear all canvas
        foreground,
        background,
        highlight,
      ].forEach(ctx => {
        const right = scale * (width + margin.left + margin.right + 10);
        const bottom = scale * (height + margin.top + margin.bottom + 10);
        ctx.clearRect(0, 0, right, bottom);
        ctx.stacks = {};
        ctx.segments = { drawn: 0, skipped: 0 };
      });
      counts = {};

      // get lines within extents
      data.map((d) => {
        if (checkIfActive(d)) {
          drawForeground(d, true);
          selected[d.id] = d;
        } else {
          path(d, background, true);
        }
      });

      // console.log(`Foreground drew ${
      //   foreground.segments.drawn
      // } and saved ${
      //   foreground.segments.skipped
      // } segments`);
      // console.log(`Background drew ${
      //   background.segments.drawn
      // } and saved ${
      //   background.segments.skipped
      // } segments`);

      drawBoundIndicators();

      if (pane.cy.vars['pcp-dfs'].value) {
        dimensions.forEach(d => {
          frequencies(d3.select(`#${getAxisId(d)} > .axis`), {
            counts, name: d, orient,
          });
        });
      }
    }

    // sorting function by value, used in scales for each numerical dimension
    function basic_sort(a, b) {
      return position(a) - position(b);
    }

    function drawBrushMinMax(data, name, pane, which) {
      brushes['brush-' + getAxisId(name)].call(d3.brush().clear);
      const extent = d3.extent(data, (p) => +p[name]);
      const selection = [extent[bounds[which]], extent[bounds[which]]];
      selection.bound = which;
      selections.set(name, selection);
      drawBrushed();
      updateCountStrings();
      dispatchEvent(
        events.LINKED_SELECTION(pane.id, publicFunctions.getSelection()),
      );
    }

    function getPCPID(str) {
      return str + where.id;
    }

    const paneDiv = document.getElementById(pane.id);
    if (!paneDiv) {
      // after a pane has been destroyed, clean pcp when invoked from an event listener
      publicFunctions.destroy();
      return;
    }

    const where = {
      id: pane.details,
      width: paneDiv.getBoundingClientRect().width,
      height: pane.height * pane.split,
      // height: document.getElementById(pane.details).getBoundingClientRect().height,
    };

    pcpHtml = {
      div: getPCPID('pcp'),
      fg: getPCPID('foreground'),
      bg: getPCPID('background'),
      hl: getPCPID('highlight'),
      interact: getPCPID('interaction'),
    };

    d3.selectAll('#' + pcpHtml.div).remove();

    const d3div = d3
      .select('#' + where.id)
      .append('div')
      .attr('id', pcpHtml.div);

    const cols = Object.keys(metadata.pld);

    if (cols.length === 0) {
      return;
    }

    // determines whether the plot appears vertically or horizontally
    const orient = where.width < where.height ? 0 : 1; // 0: ☰, 1 |||

    // set up some margins and dimensions for the svg

    // let longestLabel = cols[0].length;
    // cols.forEach(c => {
    //     longestLabel = c.length > longestLabel ? c.length : longestLabel;
    // });
    // const labelMargin = longestLabel * 5;
    // const pad = 50;
    // const margin = {
    //     top: 10 + (orient ? labelMargin / 2 : 30),
    //     right: pad + (orient ? labelMargin / 3 : 10),
    //     bottom: (pad / 2) + (orient ? 0: labelMargin / 2),
    //     left: pad + (orient ? labelMargin / 3 : labelMargin)
    // },

    const margin = {
      top: orient ? 30 : 50,
      bottom: orient ? 30 : 50,
      right: orient ? 50 : 30,
      left: orient ? 50 : 30,
    };
    const width = where.width - margin.left - margin.right;
    const height = where.height - margin.top - margin.bottom;
    const brush_width = 8;

    if (width < 5 || height < 5) {
      return; // do not draw
    }

    // variables to draw the plot vertically or horizontally
    const resp = {
      axes: {},
      scale: d3.scalePoint().range([0, orient ? width : height], 1),
      scale_orient: [d3.axisTop(), d3.axisLeft()],
      svg_dims: [width, height],
      w_h: ['width', 'height'],
      x_y: ['x', 'y'],
      // anchor: ["end", "middle"],
      anchor: ['start', 'start'],
      // title: ["rotate(-20)", "rotate(-20)"],
      title: ['translate(0, 15)', 'translate(0) rotate(90)'],
      trans: ['translate(0, ', 'translate('],
    };

    let dragging = {};

    // variables to handle data points
    const axis = resp.scale_orient[orient].ticks(
      Math.max(2, Math.trunc(resp.svg_dims[orient] / 100, 0)),
    );

    d3div.append('canvas').attr('id', pcpHtml.bg);
    d3div.append('canvas').attr('id', pcpHtml.hl);
    d3div.append('canvas').attr('id', pcpHtml.fg);

    const div = document.getElementById(pcpHtml.div);

    d3.select('#' + where.id)
      .selectAll('#' + pcpHtml.fg + ', #' + pcpHtml.bg + ', #' + pcpHtml.hl)
      .attr('width', scale * (width + margin.left + margin.right))
      .attr('height', scale * (height + margin.top + margin.bottom))
      .style('width', (width + margin.left + margin.right) + 'px')
      .style('height', (height + margin.top + margin.bottom) + 'px');

    const foreground = div.querySelector('#' + pcpHtml.fg).getContext('2d');
    const background = div.querySelector('#' + pcpHtml.bg).getContext('2d');
    const highlight = div.querySelector('#' + pcpHtml.hl).getContext('2d');

    background.strokeStyle = getComputedStyle(div).getPropertyValue('--pcp-bg-stroke');
    highlight.strokeStyle = getComputedStyle(div).getPropertyValue('--pcp-hover-stroke');

    // make the base svg for parallel coordinates
    const svg = d3div
      .append('svg')
      .attr('id', pcpHtml.interact)
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    document.getElementById(pcpHtml.interact).onmousedown = () => {
      setPane(pane.id);
    };

    // get list of dimensions and create a scale for each, considering the data types.
    dimensions = cols.filter((d) => {
      if (metadata.nominals.includes(d)) {
        const domain = data
          .map((p) => p[d])
          .filter(d => d); // filter undefined
        resp.axes[d] = d3
          .scalePoint()
          .domain(domain)
          .range([0, resp.svg_dims[orient]])
          .padding(1);
        const axis = resp.axes[d];

        axis.linear = d3
          .scaleLinear()
          .domain([resp.svg_dims[orient], 0])
          .range([resp.svg_dims[orient], 0]);

        axis.invert = (pos) => axis.linear(pos);
        axis.mapping = {};
        axis.domain().forEach((d) => (axis.mapping[d] = axis(d)));
        return axis;
      } else if (metadata.booleans.includes(d)) {
        resp.axes[d] = d3
          .scalePoint()
          .domain([false, true])
          .range([0, resp.svg_dims[orient]])
          .padding(1);
        const axis = resp.axes[d];

        axis.linear = d3
          .scaleLinear()
          .domain([resp.svg_dims[orient], 0])
          .range([resp.svg_dims[orient], 0]);

        axis.invert = (pos) => axis.linear(pos);
        axis.mapping = {};
        axis.domain().forEach((d) => (axis.mapping[d] = axis(d)));
        return axis;
      } else if (metadata.data_id != d) {
        // numbers
        const de = d3.extent(data, (p) => +p[d]);
        const extent = [
          metadata.pld[d].min !== 'Infinity'
            ? metadata.pld[d].min
            : de[0],
          metadata.pld[d].max !== 'Infinity'
            ? metadata.pld[d].max
            : de[1],
        ];

        if (extent[0] === extent[1]) {
          extent[1] = extent[0] + 1;
        }

        // start/end on 0 when possible
        if (extent[0] > 0) {
          extent[0] = 0;
        }

        if (extent[1] < 0) {
          extent[1] = 0;
        }

        return (resp.axes[d] = d3
          .scaleLinear()
          .domain([extent[1], extent[0]])
          .range([0, resp.svg_dims[orient]]));
      }
    });

    resp.scale.domain(dimensions);

    [ // setup the drawing layers
      foreground,
      background,
      highlight,
    ].forEach(ctx => {
      ctx.globalAlpha = 1 / stack;
      ctx.lineWidth = scale * 2;
      ctx.stacks = {};
      ctx.stack = stack;
    });
    highlight.stack = 1;
    highlight.globalAlpha = 1;

    // hover highlighting: cursor area visual indicator
    const cursor_rect = svg
      .append('rect')
      .attr('class', 'cursor-area')
      .attr('width', 0)
      .attr('height', 0);
    const count_tooltip = svg
      .append('text')
      .attr('class', 'selection-count-tooltip');

    // group element for each dimension (axis) and add drag motion
    const g = svg
      .selectAll('.dimension')
      .data(dimensions)
      .enter()
      .append('g')
      .attr('id', (d) => getAxisId(d))
      .attr('class', () => 'dimension')
      .on('contextmenu', (e, d) => {
        e.axisName = d; // attaches axis information to the event for context menu
      })
      .attr('transform', (d) => resp.trans[orient] + resp.scale(d) + ')')
      .call( // axes reordering
        d3
          .drag()
          .subject((d) => orient ? { x: resp.scale(d) } : { y: resp.scale(d) })
          .on('start', (_, d) => {
            dragging[d] = resp.scale(d);
          })
          .on('drag', (e, d) => {
            dragging[d] = orient
              ? (e.subject.x = Math.min(
                width + margin.right,
                Math.max(-margin.left, e.x),
              ))
              : (e.subject.y = Math.min(
                height + margin.bottom,
                Math.max(-margin.top, e.y),
              ));
            dimensions.sort(basic_sort);
            resp.scale.domain(dimensions);
            drawBrushed();
            g.attr('transform', (d) => resp.trans[orient] + position(d) + ')');
          })
          .on('end', (_, d) => {
            delete dragging[d];
            transition(d3.select(`#${pane.id}_axis_${d}`)).attr(
              'transform',
              resp.trans[orient] + resp.scale(d) + ')',
            );
            drawBrushed();
          }),
      );

    const countTooltipUpdate = _.throttle((tooltip, mouse, text) => {
      tooltip.attr('x', mouse[0] + 10);
      tooltip.attr('y', mouse[1] - 10);
      tooltip.text(text);
    }, 50);

    function drawBoundIndicators() {
      dimensions.forEach(d => {
        const s = selections.get(d);
        if (s?.bound) {
          drawBoundIndicator(d, s, foreground);
        }
      });
    }

    // cursor logic
    svg.on('mousemove', (e) => {
      const right = scale * (width + margin.left + margin.right + 10);
      const bottom = scale * (height + margin.top + margin.bottom + 10);

      [
        highlight,
        foreground,
        background,
      ].forEach(ctx => {
        ctx.clearRect(0, 0, right, bottom);
        ctx.stacks = {};
        ctx.segments = { drawn: 0, skipped: 0 };
      });

      const mouse = d3.pointer(e); // [x, y]
      const cursor_pad = 20;

      // compute closest dimension
      let dim = dimensions[0];

      dimensions.forEach(d => {
        if (
          Math.abs(position(dim) - mouse[1 - orient])
          > Math.abs(position(d) - mouse[1 - orient])
        ) {
          dim = d;
        }
      });

      // disallow highlighting if outside cursor area wrt axes locations
      const mouse_scale_pos = resp.axes[dim].invert(mouse[orient]);
      const pixelRange = resp.axes[dim].range();
      const range = [resp.axes[dim].invert(pixelRange[0]), resp.axes[dim].invert(pixelRange[1])];

      if (
        Math.abs(position(dim) - mouse[1 - orient]) > cursor_pad
        || mouse_scale_pos > Math.max(range[0], range[1])
        || mouse_scale_pos < Math.min(range[0], range[1])
      ) {
        cursor_rect.attr(resp.w_h[orient], 0);
        cursor_rect.attr(resp.w_h[1 - orient], 0);
        countTooltipUpdate(count_tooltip, mouse, '');
        data.map((point) => {
          const active = checkIfActive(point);
          if (active && point[dim] !== undefined) {
            drawForeground(point);
          } else {
            path(point, background);
          }
        });
        drawBoundIndicators();
        return;
      }

      // compute cursor area wrt the scale value
      const mouse_upper_limit = resp.axes[dim].invert(
        mouse[orient] + cursor_pad,
      );
      const mouse_lower_limit = resp.axes[dim].invert(
        mouse[orient] - cursor_pad,
      );

      // update visual indicator
      cursor_rect.attr(resp.w_h[1 - orient], cursor_pad);
      cursor_rect.attr(resp.w_h[orient], cursor_pad * 2);
      cursor_rect.attr(resp.x_y[1 - orient], position(dim) - cursor_pad / 2);
      cursor_rect.attr(resp.x_y[orient], mouse[orient] - cursor_pad);

      // compare against mouse value only on closest dimension and within brush selections
      data.map((point) => {
        const active = checkIfActive(point);
        if (point[dim] !== undefined) {
          const val = metadata.pld[dim].type === 'number'
            ? point[dim]
            : resp.axes[dim].mapping[point[dim]];
          if (active) {
            if (
              val >= Math.min(mouse_lower_limit, mouse_upper_limit)
              && val <= Math.max(mouse_lower_limit, mouse_upper_limit)
            ) {
              highlighted.add(point.id);
              path(point, highlight);
            } else {
              highlighted.delete(point.id);
              drawForeground(point);
            }
          } else {
            highlighted.delete(point.id);
            path(point, background);
          }
        } else {
          highlighted.delete(point.id);
        }
      });

      drawBoundIndicators();

      // console.log(`Highlighting layer drew: ${
      //   highlight.segments.drawn
      // } and saved ${
      //   highlight.segments.skipped
      // } segments`);

      countTooltipUpdate(count_tooltip, mouse, highlighted.size);
    });

    // axes and title.
    g.append('g')
      .attr('class', 'axis')
      .each(dim => {
        const axis_g = d3
          .select(`#${getAxisId(dim)} > .axis`)
          .call(axis.scale(resp.axes[dim]));

        if (pane.cy.vars['pcp-vs'].value) {
          violin(axis_g, {
            orient, resp, name: dim, data: data.map((d) => d[dim]),
          });
        }
        if (pane.cy.vars['pcp-hs'].value) {
          histogram(axis_g, {
            orient, resp, name: dim, data: data.map((d) => d[dim]),
          });
        }
      })
      .append('text')
      .attr('text-anchor', resp.anchor[orient])
      .attr('transform', resp.title[orient])
      .attr(resp.x_y[orient], -12)
      .text(String);

    // add and store a brush for each axis.
    const brushes = {};
    g.append('g')
      .attr('class', 'brush')
      .attr('id', (d) => 'brush-' + getAxisId(d))
      .each((d) => {
        const b = d3.select(`#brush-${getAxisId(d)}`);
        brushes['brush-' + getAxisId(d)] = b;

        if (orient) {
          b.call(
            (resp.axes[d].brush = d3.brushY().extent(
              [[-brush_width, 0], [brush_width, height]],
            )),
          );
        } else {
          b.call(
            (resp.axes[d].brush = d3.brushX().extent(
              [[0, -brush_width], [width, brush_width]],
            )),
          );
        }

        // preserve selections on redraw
        if (selections.get(d)) {
          if (!extents[d]) {
            const x = resp.axes[d](selections.get(d)[0]);
            const y = resp.axes[d](selections.get(d)[1]);
            b.call(resp.axes[d].brush.move, [x, y]);
          } else {
            const trans = d3
              .scaleLinear()
              .domain(extents[d])
              .range(resp.axes[d].linear.domain());

            selections.set(d, [trans(selections.get(d)[0]), trans(selections.get(d)[1])]);

            const x = resp.axes[d].linear(selections.get(d)[0]);
            const y = resp.axes[d].linear(selections.get(d)[1]);
            b.call(resp.axes[d].brush.move, [x, y]);
          }
        }

        // saves the extents of nominals and booleans so that they can be computed on resize
        if (resp.axes[d].linear) {
          extents[d] = resp.axes[d].linear.domain();
        }

        resp.axes[d].brush
          .on('start', brush_start)
          .on('brush', brush)
          .on('end', brush); // updates brush if clicked elsewhere on axis
      });

    makeCtxMenu(pane.details, pane, publicFunctions, {
      extras: [
        {
          label: 'Select Minimum',
          callback: (e) => drawBrushMinMax(data, e.axisName, pane, 'min'),
        },
        {
          label: 'Select Maximum',
          callback: (e) => drawBrushMinMax(data, e.axisName, pane, 'max'),
        },
      ],
    });
    drawBrushed();
    updateCountStrings();
    dispatchEvent(
      events.LINKED_SELECTION(pane.id, publicFunctions.getSelection()),
    );
  }

  draw(pane, data);

  return publicFunctions;
};

export { parallelCoords };
