"use client";

import { useMemo, useState } from "react";
import { PlusIcon, PhoneMiniIcon, SearchIcon } from "@/components/icons";
import { ColumnPicker, ColumnPickerBodyCell, ColumnPickerHeadCell, useColumnVisibility } from "@/components/ColumnPicker";
import { Pill } from "@/components/ui";
import { userAccessLabel, usersForView } from "@/lib/access-preview";
import { ADMIN_ROLE_REF, roleByRef, ROLES, type RoleRow, type UserRow } from "@/lib/mock-data";
import { USER_LIST_COLUMNS, USER_LIST_DEFAULT_COLS } from "@/lib/table-columns";

type Props = {
  title: string;
  viewId: string;
  users: UserRow[];
  roles?: RoleRow[];
  variant?: "access" | "cobradores";
  onCreate?: () => void;
  onOpenUser?: (userRef: string) => void;
};

export function UserList({
  title,
  viewId,
  users,
  roles = ROLES,
  variant = "access",
  onCreate,
  onOpenUser,
}: Props) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [applied, setApplied] = useState({ query: "", roleFilter: "", assignmentFilter: "" });
  const isCobradores = variant === "cobradores";

  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(
    USER_LIST_COLUMNS,
    USER_LIST_DEFAULT_COLS,
    { storageKey: "nexo.usuarios.listado.columns" },
  );

  const baseRows = useMemo(() => usersForView(viewId, users), [viewId, users]);

  const visible = useMemo(() => {
    return baseRows.filter((row) => {
      if (applied.roleFilter && row.roleRef !== applied.roleFilter) return false;
      if (isCobradores && applied.assignmentFilter === "asignados" && !row.collectorRef) return false;
      if (isCobradores && applied.assignmentFilter === "sin-asignar") {
        if (row.collectorRef || row.roleRef === ADMIN_ROLE_REF) return false;
      }
      if (!applied.query) return true;
      const q = applied.query.toLowerCase();
      return (
        row.ref.toLowerCase().includes(q) ||
        row.login.toLowerCase().includes(q) ||
        (row.email ?? "").toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q) ||
        row.phone.toLowerCase().includes(q) ||
        (row.document ?? "").toLowerCase().includes(q) ||
        (row.collectorRef ?? "").toLowerCase().includes(q)
      );
    });
  }, [applied, baseRows, isCobradores]);

  function search() {
    setApplied({ query, roleFilter, assignmentFilter });
  }

  function clear() {
    setQuery("");
    setRoleFilter("");
    setAssignmentFilter("");
    setApplied({ query: "", roleFilter: "", assignmentFilter: "" });
  }

  function renderCell(row: UserRow, colId: string) {
    const role = roleByRef(row.roleRef, roles);
    switch (colId) {
      case "ref":
        return <span className="ref">{row.ref}</span>;
      case "login":
        return row.login;
      case "email":
        return row.email ?? "—";
      case "name":
        return row.name;
      case "document":
        return row.document ?? "—";
      case "phone":
        return (
          <span className="cell-with-ico">
            <PhoneMiniIcon />
            {row.phone}
          </span>
        );
      case "role":
        return userAccessLabel(row, roles);
      case "collector":
        return <span className="ref">{row.collectorRef ?? "—"}</span>;
      case "lastAccess":
        return row.lastAccess ?? "—";
      case "status":
        return (
          <Pill
            label={row.active ? (role?.channels.includes("mobile") ? "App móvil" : "Activo") : "Inactivo"}
            kind={row.active ? "ok" : "paid"}
          />
        );
      default:
        return "—";
    }
  }

  return (
    <section className="panel">
      <div className="head">
        <h1>{title}</h1>
        <span className="count">{visible.length}</span>
        <div className="grow" />
        <label className="page-size">
          Ver{" "}
          <select defaultValue="25">
            <option>25</option>
            <option>50</option>
          </select>
        </label>
        {onCreate ? (
          <button className="plus" title="Nuevo usuario" type="button" onClick={onCreate}>
            <PlusIcon />
          </button>
        ) : null}
      </div>

      <div className="filters collector-filters">
        {isCobradores ? (
          <select value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)}>
            <option value="">Todos</option>
            <option value="asignados">Cobradores asignados</option>
            <option value="sin-asignar">Sin asignar</option>
          </select>
        ) : null}
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="">Todos los roles</option>
          {roles.map((role) => (
            <option key={role.ref} value={role.ref}>
              {role.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Buscar usuario, correo, teléfono…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && search()}
        />
        <button className="go" type="button" onClick={search}>
          <SearchIcon size={15} />
        </button>
        <button className="btn ghost filter-clear" type="button" onClick={clear}>
          Limpiar
        </button>
      </div>

      <div className="table-wrap">
        <table className="data list-grid">
          <thead>
            <tr className="col-titles">
              {USER_LIST_COLUMNS.filter((col) => isVisible(col.id)).map((col) => (
                <th key={col.id}>{col.label}</th>
              ))}
              <ColumnPickerHeadCell>
                <ColumnPicker
                  columns={USER_LIST_COLUMNS}
                  visibleCols={visibleCols}
                  onToggle={toggleColumn}
                />
              </ColumnPickerHeadCell>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={Math.max(visibleCols.length + 1, 1)}>No hay usuarios con esos filtros</td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={row.ref}
                  className={onOpenUser ? "clickable" : undefined}
                  onClick={() => onOpenUser?.(row.ref)}
                >
                  {USER_LIST_COLUMNS.filter((col) => isVisible(col.id)).map((col) => (
                    <td key={col.id}>{renderCell(row, col.id)}</td>
                  ))}
                  <ColumnPickerBodyCell />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
