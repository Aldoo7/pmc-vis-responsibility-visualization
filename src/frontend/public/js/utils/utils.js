function h(tag, attrs, children) {
  const el = document.createElement(tag);

  Object.keys(attrs).forEach(function (key) {
    var val = attrs[key];

    el.setAttribute(key, val);
  });

  if (children) {
    children.forEach(function (child) {
      el.appendChild(child);
    });
  }

  return el;
}

function t(text) {
  return document.createTextNode(text);
}

const DECIMAL_PLACES = 3;

function fixed(num) {
  if (num === undefined) return;
  return num != 0 ? num.toFixed(DECIMAL_PLACES) : num;
}

function getRandomColor() {
  var r = Math.floor(Math.random() * 256);
  var g = Math.floor(Math.random() * 256);
  var b = Math.floor(Math.random() * 256);

  var hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);

  return hex;
}

const colorList = [
  "#888c94",
  "#f51d05",
  "#05f7eb",
  "#0749f0",
  "#734222",
  "#1c005c",
  "#f007dc",
  "#09db00",
  "#F8F32B",
  "#f79205",
];

export { h, t, fixed, getRandomColor, colorList };
