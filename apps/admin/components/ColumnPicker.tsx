"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ColumnsIcon } from "@/components/icons";

export type ColumnOption = {
  id: string;
  label: string;
  /** No aparece en el desplegable (p. ej. columna fija). */
  pickerHidden?: boolean;
};

type UseColumnVisibilityOptions = {
  storageKey?: string;
  minVisible?: number;
};

const PICKER_WIDTH = 280;
const PICKER_MAX_HEIGHT = 420;
const VIEWPORT_GAP = 8;

export function useColumnVisibility(
  columns: ColumnOption[],
  defaultVisible: string[],
  options: UseColumnVisibilityOptions = {},
) {
  const { storageKey, minVisible = 1 } = options;
  const columnOrder = useMemo(() => columns.map((col) => col.id), [columns]);
  const [visibleCols, setVisibleCols] = useState<string[]>(defaultVisible);
  const [ready, setReady] = useState(!storageKey);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const valid = parsed.filter((id) => columnOrder.includes(id));
        // Columnas nuevas del default que aún no estaban en lo guardado.
        const missingDefaults = defaultVisible.filter(
          (id) => columnOrder.includes(id) && !parsed.includes(id),
        );
        const merged = columnOrder.filter(
          (id) => valid.includes(id) || missingDefaults.includes(id),
        );
        if (merged.length) setVisibleCols(merged);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, [storageKey, columnOrder, defaultVisible]);

  useEffect(() => {
    if (!storageKey || !ready) return;
    window.localStorage.setItem(storageKey, JSON.stringify(visibleCols));
  }, [storageKey, ready, visibleCols]);

  function toggleColumn(id: string) {
    setVisibleCols((current) => {
      if (current.includes(id)) {
        if (current.length <= minVisible) return current;
        return current.filter((col) => col !== id);
      }
      return columnOrder.filter((col) => col === id || current.includes(col));
    });
  }

  function isVisible(id: string) {
    return visibleCols.includes(id);
  }

  const activeColumns = useMemo(
    () => columns.filter((col) => visibleCols.includes(col.id)),
    [columns, visibleCols],
  );

  return { visibleCols, activeColumns, toggleColumn, isVisible, setVisibleCols };
}

type PickerProps = {
  columns: ColumnOption[];
  visibleCols: string[];
  onToggle: (id: string) => void;
  className?: string;
};

function computeMenuStyle(anchor: DOMRect): CSSProperties {
  const gap = 10;
  let top = anchor.bottom + gap;
  let left = anchor.right - PICKER_WIDTH;

  if (top + PICKER_MAX_HEIGHT > window.innerHeight - VIEWPORT_GAP) {
    top = Math.max(VIEWPORT_GAP, anchor.top - gap - PICKER_MAX_HEIGHT);
  }

  left = Math.max(VIEWPORT_GAP, Math.min(left, window.innerWidth - PICKER_WIDTH - VIEWPORT_GAP));

  return {
    position: "fixed",
    top,
    left,
    width: PICKER_WIDTH,
    maxHeight: PICKER_MAX_HEIGHT,
    zIndex: 1200,
  };
}

export function ColumnPicker({ columns, visibleCols, onToggle, className }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function reposition() {
      const anchor = btnRef.current?.getBoundingClientRect();
      if (!anchor) return;
      setMenuStyle(computeMenuStyle(anchor));
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const pickerCols = columns.filter(
    (col) => !col.pickerHidden && col.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const menu = open ? (
    <div ref={menuRef} className="col-picker col-picker-floating" style={menuStyle}>
      <input
        className="col-picker-search"
        placeholder="Buscar"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      <div className="col-picker-list">
        {pickerCols.map((col) => (
          <label key={col.id} className="col-picker-item">
            <input
              type="checkbox"
              checked={visibleCols.includes(col.id)}
              onChange={() => onToggle(col.id)}
            />
            <span>{col.label}</span>
          </label>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className={className ? `col-picker-wrap ${className}` : "col-picker-wrap"} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={open ? "cols-btn on" : "cols-btn"}
        title="Columnas visibles"
        aria-label="Columnas visibles"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ColumnsIcon size={20} />
      </button>
      {mounted && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

/** Id de la última columna visible (para colgar el desplegable). */
export function lastVisibleColumnId(
  columns: { id: string }[],
  isVisible: (id: string) => boolean,
) {
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const id = columns[index]?.id;
    if (id && isVisible(id)) return id;
  }
  return null;
}

/** Celda fija al borde derecho del thead para el desplegable de columnas. */
export function ColumnPickerHeadCell({ children }: { children: ReactNode }) {
  return <th className="col-picker-cell">{children}</th>;
}

/** Celda espejo en tbody (mantiene alineación de columnas). */
export function ColumnPickerBodyCell() {
  return <td className="col-picker-cell" aria-hidden />;
}

/** @deprecated Usar ColumnPickerHeadCell al final del thead. */
export function headerWithColumnPicker(label: ReactNode, picker: ReactNode | null | undefined) {
  if (!picker) return label;
  return (
    <span className="th-label-with-picker">
      <span className="th-label-text">{label}</span>
      {picker}
    </span>
  );
}
