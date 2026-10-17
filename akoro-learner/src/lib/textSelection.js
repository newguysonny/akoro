/**
 * textSelection.js — keeps a reader selection on the words the learner is
 * dragging over, on every transparent text layer (pdf.js pages and the
 * extraction layer over scans and images).
 *
 * A text layer is absolutely positioned spans over a picture. Between the
 * spans there is nothing selectable, so when a finger or a selection handle
 * leaves the words the browser snaps the selection's end to the nearest
 * selectable thing in DOM order — the end of the layer, the next page, the
 * whole document — and the page "goes all purple". pdf.js's own viewer
 * (web/text_layer_builder.js) fixes this with an `endOfContent` element:
 * while a selection is live it covers the layer and is moved to sit right
 * after the selection's moving end, so the gaps resolve to that spot.
 * That fix lives in pdf.js's VIEWER, not in the TextLayer the reader uses,
 * so it is done here — plus two reader rules:
 *
 *   - one page at a time: a selection reaching into another layer is
 *     pulled back to the edge of the page it started on;
 *   - "Select all" (the phone's own menu) selects the page being read,
 *     not every page and the app around it.
 *
 *   const off = registerTextLayer(div);   // after the layer has rendered
 *   off();                                 // before it is cleared
 */

const layers = new Map();          // layer div → its endOfContent div
let teardown = null;               // removes the document listeners
let lastLayer = null;              // the layer the learner last touched
let prevRange = null;

const layerOf = (node) => {
  for (let n = node && (node.nodeType === 1 ? node : node.parentNode); n; n = n.parentNode) {
    if (layers.has(n)) return n;
  }
  return null;
};

/** First / last non-empty text node of a layer (its words, not its chrome). */
function edgeText(layer, last) {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (t.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  let found = null;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!last) return t;
    found = t;
  }
  return found;
}

function reset(layer, end) {
  layer.append(end);
  end.removeAttribute('style');
  layer.classList.remove('selecting');
}

/** Lay the moved end over the WHOLE layer, whichever positioned span now holds it. */
function coverLayer(layer, end) {
  const host = end.offsetParent;
  if (!host || host === layer) { end.removeAttribute('style'); return; }
  const lr = layer.getBoundingClientRect(), hr = host.getBoundingClientRect();
  const scale = layer.offsetWidth ? lr.width / layer.offsetWidth : 1;   // the reader's zoom is a CSS transform
  Object.assign(end.style, {
    inset: 'auto',
    left: `${(lr.left - hr.left) / scale}px`, top: `${(lr.top - hr.top) / scale}px`,
    width: `${layer.offsetWidth}px`, height: `${layer.offsetHeight}px`,
  });
}

/** A selection that crosses into another layer, pulled back to its own page. → true if changed. */
function clampToOneLayer(sel) {
  const range = sel.getRangeAt(0);
  const touched = [...layers.keys()].filter((l) => range.intersectsNode(l));
  if (touched.length < 2 && layerOf(sel.anchorNode) && layerOf(sel.focusNode)) return false;
  if (!touched.length) return false;
  const home = layerOf(sel.anchorNode);
  if (!home) {
    // Anchored outside every layer — the phone's "Select all": the page being read.
    const page = touched.includes(lastLayer) ? lastLayer : touched[0];
    const first = edgeText(page, false), last = edgeText(page, true);
    if (!first || !last) return false;
    sel.setBaseAndExtent(first, 0, last, last.nodeValue.length);
    return true;
  }
  if (layerOf(sel.focusNode) === home) return false;
  const forward = !!(sel.anchorNode.compareDocumentPosition(sel.focusNode) & Node.DOCUMENT_POSITION_FOLLOWING);
  const edge = edgeText(home, forward);
  if (!edge) return false;
  sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, edge, forward ? edge.nodeValue.length : 0);
  return true;
}

function onSelectionChange() {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    layers.forEach((end, layer) => reset(layer, end));
    prevRange = null;
    return;
  }
  if (clampToOneLayer(sel)) return;   // the clamp fires selectionchange again
  const range = sel.getRangeAt(0);
  for (const [layer, end] of layers) {
    if (range.intersectsNode(layer)) layer.classList.add('selecting');
    else reset(layer, end);
  }
  // Move the end marker to just after (or before) the edge being dragged.
  const modifyStart = prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0
    || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
  let anchor = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
  // An end at offset 0 sits BEFORE that node: the marker goes after the
  // previous words, or every gap would pull the selection a line further.
  if (!modifyStart && range.endOffset === 0) {
    const layerHere = layerOf(anchor);
    do {
      while (anchor && !anchor.previousSibling && anchor !== layerHere) anchor = anchor.parentNode;
      if (!anchor || anchor === layerHere) break;
      anchor = anchor.previousSibling;
    } while (!anchor.childNodes.length || anchor.classList?.contains('endOfContent'));
  }
  const layer = layerOf(anchor);
  const end = layer && layers.get(layer);
  if (end && anchor !== layer && anchor !== end && anchor.parentElement) {
    anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
    coverLayer(layer, end);
    lastLayer = layer;
  }
  prevRange = range.cloneRange();
}

function listen() {
  if (teardown) return;
  const ac = new AbortController();
  const { signal } = ac;
  const onDown = (e) => {
    const layer = layerOf(e.target);
    if (layer) { lastLayer = layer; layer.classList.add('selecting'); }
    // The picture and the gaps don't select, so a tap there wouldn't clear
    // a selection by itself — clear it, the way a tap on paper would.
    const onWords = layer && e.target.nodeName === 'SPAN';
    if (!onWords && !e.shiftKey && e.target.closest?.('.sel-page')) document.getSelection()?.removeAllRanges();
  };
  // A phone's selection handles move it after pointerup: their
  // selectionchange lays the marker over the layer again.
  const resetAll = () => layers.forEach((end, layer) => reset(layer, end));
  document.addEventListener('pointerdown', onDown, { signal });
  document.addEventListener('pointerup', resetAll, { signal });
  window.addEventListener('blur', resetAll, { signal });
  document.addEventListener('selectionchange', onSelectionChange, { signal });
  teardown = () => ac.abort();
}

/** Guard one rendered text layer. → unregister(). */
export function registerTextLayer(layer) {
  if (!layer || typeof document === 'undefined') return () => {};
  let end = layers.get(layer);
  if (!end || !layer.contains(end)) {
    end = document.createElement('div');
    end.className = 'endOfContent';
    end.setAttribute('aria-hidden', 'true');
    layer.append(end);
    layers.set(layer, end);
  }
  listen();
  return () => {
    end.remove();
    layers.delete(layer);
    if (lastLayer === layer) lastLayer = null;
    if (!layers.size && teardown) { teardown(); teardown = null; prevRange = null; }
  };
}
