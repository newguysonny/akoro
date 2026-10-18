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
 */
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

  const onMove = useCallback((e) => {
    const st = state.current;
    if (!st.active || !st.dragEl) return;
    const list = st.dragEl.parentNode;
    st.dragEl.style.top = `${e.clientY - st.dragEl.offsetHeight / 2}px`;

    // Find target index from pointer Y
    const items = Array.from(list.querySelectorAll(':scope > :not(.pc-dragging):not(.pc-placeholder)'));
    let target = st.dragIndex;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { target = i; break; }
      target = i + 1;
    }
    target = Math.max(0, Math.min(items.length, target));
    const cur = Array.from(list.children).indexOf(st.phEl);
    if (target !== cur) {
      if (target < cur) list.insertBefore(st.phEl, list.children[target]);
      else list.insertBefore(st.phEl, list.children[target + 1] || null);
    }
  }, []);

  const onUp = useCallback(() => {
    const st = state.current;
    if (!st.active) { cleanup(); return; }
    document.removeEventListener('pointermove', onMove);
    const list = st.dragEl.parentNode;
    const newIdx = Array.from(list.children).indexOf(st.phEl);
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
    st.dragEl.style.left = `${r.left}px`;
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
          if (Math.abs(ev.clientY - st.startY) > 6) { startDrag(ev.clientX, ev.clientY); detach(); }
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
