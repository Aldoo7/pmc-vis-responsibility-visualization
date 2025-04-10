// adapted from https://observablehq.com/@ssiegmund/violin-plot-playground

function violin(svg, {
  orient, resp, name, data,
} = {}) {
  if (resp.axes[name].linear) {
    // the .linear scale is set for nominals / booleans,
    // which don't make sense with violin plots
    return;
  }

  const scale = resp.axes[name];
  const apperture = 10;
  const bandwidth = 0.3;
  const thds = scale.ticks(40);

  function kde(kernel, thds) {
    return (V) => thds.map((t) => [t, d3.mean(V, (d) => kernel(t - d))]);
  }

  function epanechnikov(bandwidth) {
    return (x) => Math.abs((x /= bandwidth)) <= 1 ? (0.75 * (1 - x * x)) / bandwidth : 0;
  }

  const density = kde(epanechnikov(bandwidth), thds);
  const values = density(data);
  const max = d3.max(values.map(d => d[1]));
  const s = d3
    .scaleLinear()
    .domain([-max, max])
    .range([-apperture, apperture]);

  const area = d3.area();

  if (orient) {
    area.y(d => scale(d[0]))
      .x0(d => s(-d[1]))
      .x1(d => s(d[1]));
  } else {
    area.x(d => scale(d[0]))
      .y0(d => s(-d[1]))
      .y1(d => s(d[1]));
  }

  area.curve(d3.curveCatmullRom);

  svg.append('g')
    .attr('class', 'violin')
    .append('path')
    .datum(values)
    .attr('d', area);
}

function histogram(svg, {
  orient, resp, name, data,
} = {}) {
  svg.selectAll('.histogram').remove();
  const amount = 30;
  const nominal = resp.axes[name].linear;
  const scale = nominal || resp.axes[name];
  const apperture = 15;

  const ds = data.map(d => nominal ? +resp.axes[name].mapping[d] : scale(d)).sort();
  const dom = scale.domain().map(d => scale(d));
  const maxd = d3.max(dom);
  const step = maxd / amount;
  let i = d3.min(dom);

  const values = [];
  while (i < maxd) {
    // console.log(`bin ${i}, ${i + step}`);
    if (maxd < i + (step * 2)) { // last
      values.push([
        i,
        ds.filter(d => d >= i).length,
        // console.log(`${d} ? ${d > i && d <= (i + step)}`);
        maxd - i,
      ]);
      i = maxd;
    } else {
      values.push([
        i,
        ds.filter(d => d >= i && d < (i + step)).length,
        // console.log(`${d} ? ${d >= i && d < (i + step)}`);
        step,
      ]);
      i += step;
    }
  }

  const max = d3.max(values.map(d => d[1]));

  const s = d3
    .scaleLinear()
    .domain([-max, max])
    .range([-apperture, apperture]);

  const bars = svg.append('g')
    .attr('class', 'histogram')
    .selectAll()
    .data(values)
    .enter()
    .append('rect');

  if (orient) {
    bars.attr('x', 0)
      .attr('y', k => k[0])
      .attr('width', k => s(k[1]))
      .attr('height', k => k[2]);
  } else {
    bars.attr('y', 0)
      .attr('x', k => k[0])
      .attr('height', k => s(k[1]))
      .attr('width', k => k[2]);
  }
}

function frequencies(svg, { counts, name, orient }) {
  // note: this is based on counts done over the values of each property.
  // close decimal imprecisions can make it so that bars overlap.

  svg.selectAll('.bars').remove();
  const apperture = 15;
  const max = d3.max(Object.values(counts[name]));
  const s = d3
    .scaleLinear()
    .domain([-max, max])
    .range([-apperture, apperture]);

  const height = 1;
  const bars = svg.append('g')
    .attr('class', 'bars')
    .selectAll()
    .data(Object.keys(counts[name]))
    .enter()
    .append('rect');

  if (orient) {
    bars.attr('x', 0)
      .attr('y', k => (+k) - (height / 2))
      .attr('width', k => s(counts[name][k]))
      .attr('height', height);
  } else {
    bars.attr('x', k => (+k) - (height / 2))
      .attr('y', 0)
      .attr('width', height)
      .attr('height', k => s(counts[name][k]));
  }
}

export { violin, histogram, frequencies };
