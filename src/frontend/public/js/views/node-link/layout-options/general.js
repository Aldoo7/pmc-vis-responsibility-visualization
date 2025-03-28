const controls = [
  {
    label: 'Animate',
    param: 'animate',
    type: 'toggle',
  },
  {
    label: 'Fit to view',
    param: 'fit',
    type: 'toggle',
  },
  {
    label: 'Animation duration (ms)',
    param: 'animationDuration',
    min: 200,
    max: 5000,
    type: 'slider',
  },
];

export { controls };
