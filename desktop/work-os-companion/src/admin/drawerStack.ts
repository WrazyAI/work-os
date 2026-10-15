/** Top-layer bookkeeping for the administration drawers.
 *
 * Drawers can be layered (a person's update detail opens over the person
 * drawer), but every open drawer listens for Escape on the document. Without a
 * shared order they would all close on one press. Each open drawer registers a
 * token here; only the token on top answers Escape, so the topmost surface
 * closes alone and the one beneath stays open. */

const layers: symbol[] = [];

export function pushDrawerLayer(token: symbol) {
  layers.push(token);
}

export function removeDrawerLayer(token: symbol) {
  const index = layers.indexOf(token);
  if (index >= 0) layers.splice(index, 1);
}

export function isTopDrawerLayer(token: symbol) {
  return layers.length > 0 && layers[layers.length - 1] === token;
}

/** Test hook: the module-level order is shared by every drawer instance. */
export function resetDrawerLayers() {
  layers.length = 0;
}
