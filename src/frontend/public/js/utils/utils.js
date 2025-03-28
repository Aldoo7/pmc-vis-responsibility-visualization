function h(tag, attrs, children) {
  const el = document.createElement(tag);

  Object.keys(attrs).forEach(key => {
    var val = attrs[key];

    el.setAttribute(key, val);
  });

  if (children) {
    children.forEach(child => {
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

const colorList = [
  '#888c94',
  '#f51d05',
  '#05f7eb',
  '#0749f0',
  '#734222',
  '#1c005c',
  '#f007dc',
  '#09db00',
  '#F8F32B',
  '#f79205',
];

export {
  h, t, fixed, colorList,
};
