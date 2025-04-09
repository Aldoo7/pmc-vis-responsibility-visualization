// adapted from https://observablehq.com/@ssiegmund/violin-plot-playground

function violin(svg, {
  orient, resp, name, data,
} = {}) {
  const scale = resp.axes[name];
  const apperture = 5;
  const bandwidth = 0.3;
  const thds = scale.ticks(20);

  function kde(kernel, thds) {
    return (V) => thds.map((t) => [t, d3.mean(V, (d) => kernel(t - d))]);
  }

  function epanechnikov(bandwidth) {
    return (x) => Math.abs((x /= bandwidth)) <= 1 ? (0.75 * (1 - x * x)) / bandwidth : 0;
  }

  const density = kde(epanechnikov(bandwidth), thds);

  const d_values = density(data);
  const d_max = d3.max(d_values.map(d => d[1]));

  const ds = d3 // density scale
    .scaleLinear()
    .domain([-d_max, d_max])
    .range([-apperture, apperture]);

  const area = d3.area();
  if (orient) {
    area.y(d => scale(d[0]))
      .x0(d => ds(-d[1]))
      .x1(d => ds(d[1]));
  } else {
    area.x(d => scale(d[0]))
      .y0(d => ds(-d[1]))
      .y1(d => ds(d[1]));
  }
  area.curve(d3.curveCatmullRom);

  svg.append('path')
    .datum(d_values)
    .style('stroke', 'none')
    .style('fill', '#000')
    .style('opacity', 0.1)
    .attr('d', area);
}

function histogram(svg, {
  orient, resp, name, data,
} = {}) {
  const scale = resp.axes[name];
  const apperture = 15;
  const ticks = scale.ticks(50);

  function frequencies(ticks) {
    return (V) => ticks.map(
      (t, i) => [t, V.filter(d => i > 0 ? bins[i - 1] > d && d >= t : d >= t).length],
    );
  }

  const bins = frequencies(ticks);
  const h_values = bins(data);
  const h_max = d3.max(h_values.map(d => d[1]));

  const hs = d3 // histogram scale
    .scaleLinear()
    .domain([-h_max, h_max])
    .range([-apperture, apperture]);

  const harea = d3.area();
  if (orient) {
    harea.y(d => scale(d[0]))
      .x0(d => hs(-d[1]))
      .x1(d => hs(d[1]));
  } else {
    harea.x(d => scale(d[0]))
      .y0(d => hs(-d[1]))
      .y1(d => hs(d[1]));
  }
  harea.curve(d3.curveStep);

  svg.append('path')
    .datum(h_values)
    .style('stroke', 'none')
    .style('fill', '#000')
    .style('opacity', 0.5)
    .attr('d', harea);
}

export { violin, histogram };
