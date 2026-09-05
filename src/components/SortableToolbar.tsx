import { Children, isValidElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { moveToolbarItem, normalizeToolbarOrder, TOOLBAR_ORDER_KEY } from "../lib/toolbarOrder";

interface SortableToolbarProps {
  children: ReactNode;
}

interface ToolbarEntry {
  id: string | null;
  node: ReactNode;
}

interface DragSession {
  id: string;
  startX: number;
  startY: number;
}

function entriesFrom(children: ReactNode): ToolbarEntry[] {
  return Children.toArray(children).map((node) => {
    if (!isValidElement<Record<string, unknown>>(node)) return { id: null, node };
    const id = node.props["data-toolbar-id"];
    return { id: typeof id === "string" ? id : null, node };
  });
}

export function SortableToolbar({ children }: SortableToolbarProps) {
  const entries = useMemo(() => entriesFrom(children), [children]);
  const defaults = useMemo(() => entries.flatMap((entry) => entry.id ? [entry.id] : []), [entries]);
  const [order, setOrder] = useState(() => normalizeToolbarOrder(localStorage.getItem(TOOLBAR_ORDER_KEY), defaults));
  const [menu, setMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const drag = useRef<DragSession | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  const saveOrder = (next: string[]) => {
    orderRef.current = next;
    setOrder(next);
    try {
      localStorage.setItem(TOOLBAR_ORDER_KEY, JSON.stringify(next));
    } catch {
      // The current session remains sortable when storage is unavailable.
    }
  };

  useEffect(() => {
    const repaired = normalizeToolbarOrder(localStorage.getItem(TOOLBAR_ORDER_KEY), defaults);
    if (repaired.join("\0") !== orderRef.current.join("\0")) setOrder(repaired);
  }, [defaults]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".toolbar-context-menu")) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [menu]);

  const startDrag = (event: React.PointerEvent, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { id, startX: event.clientX, startY: event.clientY };
    const move = (moveEvent: PointerEvent) => {
      const session = drag.current;
      if (!session || Math.hypot(moveEvent.clientX - session.startX, moveEvent.clientY - session.startY) < 6) return;
      toolbar.current?.classList.add("toolbar-sorting");
      const bounds = toolbar.current?.getBoundingClientRect();
      if (toolbar.current && bounds) {
        if (moveEvent.clientX < bounds.left + 34) toolbar.current.scrollLeft -= 18;
        if (moveEvent.clientX > bounds.right - 34) toolbar.current.scrollLeft += 18;
      }
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>("[data-toolbar-item]");
      const targetId = target?.dataset.toolbarItem;
      if (!targetId || targetId === session.id) return;
      const after = moveEvent.clientX > target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
      saveOrder(moveToolbarItem(orderRef.current, session.id, targetId, after));
    };
    const finish = () => {
      drag.current = null;
      toolbar.current?.classList.remove("toolbar-sorting");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const nodesById = new Map(entries.flatMap((entry) => entry.id ? [[entry.id, entry.node] as const] : []));
  const orderedNodes = order.flatMap((id) => nodesById.has(id) ? [{ id, node: nodesById.get(id)! }] : []);
  let movableIndex = 0;

  return (
    <div className="editor-toolbar" ref={toolbar}>
      {entries.map((entry, index) => {
        if (!entry.id) return <span className="toolbar-fixed-slot" key={`fixed-${index}`}>{entry.node}</span>;
        const ordered = orderedNodes[movableIndex++] ?? entry;
        return (
          <span
            className="sortable-toolbar-item"
            data-toolbar-item={ordered.id}
            key={ordered.id}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ id: ordered.id!, left: event.clientX, top: event.clientY });
            }}
          >
            <button className="toolbar-drag-handle" aria-label={`拖动 ${ordered.id}`} onPointerDown={(event) => startDrag(event, ordered.id!)}><span aria-hidden="true" /></button>
            {ordered.node}
          </span>
        );
      })}
      {menu && createPortal(
        <div className="toolbar-context-menu" role="menu" style={{ left: menu.left, top: menu.top }}>
          <button onClick={() => { saveOrder([menu.id, ...orderRef.current.filter((id) => id !== menu.id)]); setMenu(null); }}>移到最前面</button>
          <button onClick={() => { saveOrder(defaults); setMenu(null); }}>恢复默认顺序</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
