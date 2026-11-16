import { useRef, useCallback } from 'react';

/**
 * useDragReorder — long-press drag to reorder for touch + mouse.
 *
 * Usage:
 *   const { getItemProps, isDragging } = useDragReorder({
 *     onReorder: (fromIndex, toIndex) => { ... },
 *   });
 *   items.map((item, i) => (
 *     <div key={item.id} {...getItemProps(i)}>{...}</div>
 *   ));
 *
 * - Touch: long-press (450ms) activates drag; item lifts with scale + shadow.
 * - Mouse: drag the handle (element with [data-drag-handle]) or move >6px after mousedown.
 * - During drag: a dashed placeholder shows the drop position.
 * - On release: onReorder(fromIndex, toIndex) is called.
 *
 * The drop position is computed in TWO dimensions, so the hook works in
 * grids (Programs / Sections / Courses cards) as well as vertical lists
 * (Course contents): items are grouped into rows by their top edge; the
 * pointer's row decides the row, and within a multi-item row the pointer's
 * X decides the slot (within a single-item row, the Y centre decides, as
 * a plain list always behaved). Indices are counted in ONE basis — the
 * number of real items before the placeholder — so the index reported on
 * drop is exactly the slot the placeholder was showing.
 */

/**
 * insertionIndex — pure: given the rects of the sibling items (DOM order,
 * dragged item and placeholder excluded) and a pointer position, return
 * the slot the dragged item would occupy if dropped now (0..rects.length).
 */
export function insertionIndex(rects, x, y) {
  // Group into rows: items whose top edges align (grid items in a row
  // share a top; a list item is a row of one).
  const rows = [];
  rects.forEach((r, i) => {
    const last = rows[rows.length - 1];
    if (last && Math.abs(r.top - last.top) <= 2) {
      last.items.push({ r, i });
      last.bottom = Math.max(last.bottom, r.bottom);
    } else {
      rows.push({ top: r.top, bottom: r.bottom, items: [{ r, i }] });
    }
  });

  for (const row of rows) {
    if (y < row.top) return row.items[0].i;             // above this row
    if (y <= row.bottom) {                              // inside this row's band
      if (row.items.length === 1) {
        const { r, i } = row.items[0];
        return y < r.top + r.height / 2 ? i : i + 1;    // list behaviour: Y centre decides
      }
      for (const { r, i } of row.items) {               // grid row: X centre decides
        if (x < r.left + r.width / 2) return i;
      }
      return row.items[row.items.length - 1].i + 1;     // past the row's last item
    }
    // below this row — keep scanning
  }
  return rects.length;                                  // below everything
}

export function useDragReorder({ onReorder }) {
  const state = useRef({
    dragEl: null, dragIndex: -1, active: false,
    startX: 0, startY: 0, longT: null, phEl: null,
  });

  const cleanup = useCallback(() => {
    const st = state.current;
    clearTimeout(st.longT);
    document.removeEventListener('pointermove', onMove);
    if (st.dragEl) {
      st.dragEl.classList.remove('pc-dragging');
      st.dragEl.style.cssText = '';
    }
    if (st.phEl) st.phEl.remove();
    st.dragEl = null; st.phEl = null; st.active = false;
  }, []);

  // The placeholder's slot: how many real items sit before it. This is
  // the dragged item's final index if dropped now — the single basis
  // every index in this hook is counted in.
  const slotOf = (list, st) => {
    let slot = 0;
    for (const child of list.children) {
      if (child === st.phEl) break;
      if (child !== st.dragEl) slot += 1;
    }
    return slot;
  };

  const onMove = useCallback((e) => {
    const st = state.current;
    if (!st.active || !st.dragEl) return;
    const list = st.dragEl.parentNode;
    // The dragged card follows the pointer in both axes.
    st.dragEl.style.left = `${e.clientX - st.dragEl.offsetWidth / 2}px`;
    st.dragEl.style.top = `${e.clientY - st.dragEl.offsetHeight / 2}px`;

    const items = Array.from(list.querySelectorAll(':scope > :not(.pc-dragging):not(.pc-placeholder)'));
    const target = insertionIndex(items.map((el) => el.getBoundingClientRect()), e.clientX, e.clientY);
    if (target !== slotOf(list, st)) {
      // Insert the placeholder before the item currently holding the
      // target slot, or at the end when the target is past the last item.
      list.insertBefore(st.phEl, items[target] || null);
    }
  }, []);

  const onUp = useCallback(() => {
    const st = state.current;
    if (!st.active) { cleanup(); return; }
    document.removeEventListener('pointermove', onMove);
    const list = st.dragEl.parentNode;
    const newIdx = slotOf(list, st);
    const fromIdx = st.dragIndex;
    cleanup();
    if (newIdx !== fromIdx && newIdx >= 0) onReorder(fromIdx, newIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReorder, onMove, cleanup]);

  const startDrag = useCallback((x, y) => {
    const st = state.current;
    if (!st.dragEl || st.active) return;
    st.active = true;
    const r = st.dragEl.getBoundingClientRect();
    const list = st.dragEl.parentNode;

    st.phEl = document.createElement('div');
    st.phEl.className = 'pc-placeholder';
    st.phEl.style.height = `${r.height}px`;
    list.insertBefore(st.phEl, st.dragEl.nextSibling);

    st.dragEl.classList.add('pc-dragging');
    st.dragEl.style.width = `${r.width}px`;
    st.dragEl.style.left = `${x - r.width / 2}px`;
    st.dragEl.style.top = `${y - r.height / 2}px`;

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
    document.addEventListener('pointercancel', onUp, { once: true });
    if (navigator.vibrate) navigator.vibrate(15);
  }, [onMove, onUp]);

  const getItemProps = useCallback((index) => ({
    onPointerDown: (e) => {
      const st = state.current;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      st.startX = e.clientX; st.startY = e.clientY;
      st.dragEl = e.currentTarget; st.dragIndex = index;
      const isGrip = e.target.closest('[data-drag-handle]');
      if (e.pointerType === 'touch' && !isGrip) {
        st.longT = setTimeout(() => startDrag(e.clientX, e.clientY), 450);
      } else if (isGrip) {
        startDrag(e.clientX, e.clientY);
      } else {
        // Mouse: activate on movement to avoid click conflicts
        const mv = (ev) => {
          if (Math.abs(ev.clientX - st.startX) > 6 || Math.abs(ev.clientY - st.startY) > 6) { startDrag(ev.clientX, ev.clientY); detach(); }
        };
        const up = () => detach();
        const detach = () => {
          clearTimeout(st.longT);
          st.dragEl?.removeEventListener('pointermove', mv);
          st.dragEl?.removeEventListener('pointerup', up);
          st.dragEl?.removeEventListener('pointercancel', up);
        };
        st.dragEl.addEventListener('pointermove', mv);
        st.dragEl.addEventListener('pointerup', up);
        st.dragEl.addEventListener('pointercancel', up);
      }
    },
    onPointerUp: () => clearTimeout(state.current.longT),
    onPointerCancel: () => clearTimeout(state.current.longT),
    style: { touchAction: 'none' },
  }), [startDrag]);

  return { getItemProps };
}
