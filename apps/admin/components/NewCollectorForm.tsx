"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  COLLECTOR_ROLE_REF,
  nextCollectorCode,
  ROLES,
  suggestedCollectorLogin,
  type CollectorRow,
} from "@/lib/mock-data";
import { rolePermissions } from "@/lib/access-preview";

export type CollectorDraft = {
  name: string;
  phone: string;
  document: string;
  notes: string;
  active: boolean;
  login: string;
  mobileAccess: boolean;
};

type Props = {
  collector?: CollectorRow;
  code?: string;
  onCancel: () => void;
  onSave: (draft: CollectorDraft) => void;
};

const collectorRole = ROLES.find((row) => row.ref === COLLECTOR_ROLE_REF) ?? ROLES[1];

export function NewCollectorForm({ collector, code, onCancel, onSave }: Props) {
  const collectorCode = code ?? collector?.ref ?? nextCollectorCode();
  const [login, setLogin] = useState(collector?.login ?? "");
  const permissions = useMemo(() => rolePermissions(collectorRole), []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: String(form.get("nombre") ?? "").trim(),
      phone: String(form.get("telefono") ?? "").trim(),
      document: String(form.get("documento") ?? "").trim(),
      notes: String(form.get("notas") ?? "").trim(),
      active: form.get("activo") === "on",
      login: String(form.get("login") ?? login).trim(),
      mobileAccess: form.get("acceso_movil") === "on",
    });
  }

  function suggestLogin(name: string) {
    const next = suggestedCollectorLogin(name);
    if (next) setLogin(next);
  }

  return (
    <form className="sheet collector-create" onSubmit={onSubmit}>
      <div className="loan-file-title">
        <h1>{collector ? "Modificar cobrador" : "Nuevo cobrador"}</h1>
        <span className="sheet-code">{collectorCode}</span>
      </div>

      <div className="sheet-body">
        <div className="sheet-fields">
          <p className="section-label">Datos del cobrador</p>

          <div className="sheet-row split">
            <label className="sheet-label" htmlFor="cob-nombre">
              Nombre
            </label>
            <input
              id="cob-nombre"
              name="nombre"
              required
              autoComplete="name"
              placeholder="Nombre completo"
              defaultValue={collector?.name}
              onBlur={(event) => suggestLogin(event.target.value)}
            />
            <label className="sheet-label" htmlFor="cob-documento">
              Documento
            </label>
            <input
              id="cob-documento"
              name="documento"
              autoComplete="off"
              placeholder="Cédula o ID"
              defaultValue={collector?.document}
            />
          </div>

          <div className="sheet-row split">
            <label className="sheet-label" htmlFor="cob-telefono">
              Teléfono (celular)
            </label>
            <input
              id="cob-telefono"
              name="telefono"
              required
              type="tel"
              autoComplete="tel"
              placeholder="300 000 0000"
              defaultValue={collector?.phone}
            />
            <span className="sheet-label">Cobertura</span>
            <input
              readOnly
              tabIndex={-1}
              value="Todas las zonas · según cobros del día"
              aria-readonly
            />
          </div>

          <div className="sheet-row">
            <label className="sheet-label" htmlFor="cob-notas">
              Notas
            </label>
            <textarea
              id="cob-notas"
              name="notas"
              placeholder="Vehículo, horario, observaciones…"
              defaultValue={collector?.notes}
            />
          </div>

          <label className="collector-active">
            <input type="checkbox" name="activo" defaultChecked={collector?.active ?? true} />
            Cobrador activo (disponible para rutas y cobros en campo)
          </label>

          <p className="section-label access-section">Acceso móvil · usuario del sistema</p>

          <div className="sheet-row split">
            <label className="sheet-label" htmlFor="cob-login">
              Usuario / correo
            </label>
            <input
              id="cob-login"
              name="login"
              required
              type="email"
              autoComplete="username"
              placeholder="nombre.apellido@nexo.com"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
            />
            <span className="sheet-label">Rol asignado</span>
            <input readOnly tabIndex={-1} value={`${collectorRole.name} · App móvil`} aria-readonly />
          </div>

          <label className="collector-active">
            <input
              type="checkbox"
              name="acceso_movil"
              defaultChecked={collector?.mobileAccess ?? true}
            />
            Crear acceso móvil (usuario vinculado a este cobrador)
          </label>

          <div className="access-perms">
            <span className="sheet-label">Permisos del rol Cobrador</span>
            <ul>
              {permissions.map((entry) => (
                <li key={entry.id}>{entry.label}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn primary">
          {collector ? "Guardar cambios" : "Crear cobrador y usuario"}
        </button>
      </div>
    </form>
  );
}
