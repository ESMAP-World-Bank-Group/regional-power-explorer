/** Calls `fn` once, on the first frame drawn after `sourceId` has loaded its data. */
export function onFirstDraw(map, sourceId, fn) {
  const check = () => {
    if (!map.getSource(sourceId) || !map.isSourceLoaded(sourceId)) return;
    map.off('render', check);
    fn();
  };
  map.on('render', check);
  map.triggerRepaint();
}
