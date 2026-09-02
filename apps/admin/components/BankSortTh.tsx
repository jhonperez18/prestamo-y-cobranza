"use client";

import { useState } from "react";
import type { BankMovementSortKey, BankSortDir } from "@/lib/bank";

type Props = {
  label: string;
  column: BankMovementSortKey;
  activeColumn: BankMovementSortKey;
  sortDir: BankSortDir;
  onSort: (column: BankMovementSortKey) => void;
  align?: "left" | "right";
  className?: string;
};

export function BankSortTh({
  label,
  column,
  activeColumn,
  sortDir,
  onSort,
  align = "left",
  className,
}: Props) {
  const active = activeColumn === column;
  const classes = [
    "sortable",
    active ? "sorted" : "",
    align === "right" ? "right bank-num" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <th
      className={classes}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        className={align === "right" ? "th-sort th-sort-right" : "th-sort"}
        onClick={() => onSort(column)}
      >
        <span className="th-sort-arrow" aria-hidden>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
        </span>
        {label}
      </button>
    </th>
  );
}

export function useBankMovementSort(defaultColumn: BankMovementSortKey = "valueDate") {
  const [sortKey, setSortKey] = useState(defaultColumn);
  const [sortDir, setSortDir] = useState<BankSortDir>("desc");

  function toggleSort(column: BankMovementSortKey) {
    if (sortKey === column) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(column);
    setSortDir("desc");
  }

  return { sortKey, sortDir, toggleSort };
}
