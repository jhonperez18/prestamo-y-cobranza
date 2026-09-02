"use client";

import { useRef, useState, type FormEvent } from "react";
import { CameraIcon } from "@/components/icons";
import { nextClientCode, type ClientRow, type RouteRow } from "@/lib/mock-data";

export type ClientDraft = {
  name: string;
  lastName: string;
  document: string;
  route: string;
  email: string;
  city: string;
  barrio: string;
  address: string;
  notes: string;
  photo?: string;
};

type Props = {
  client?: ClientRow;
  code?: string;
  routes: RouteRow[];
  onCancel: () => void;
  onSave: (draft: ClientDraft) => void;
};

export function NewClientForm({
  client,
  code,
  routes,
  onCancel,
  onSave,
}: Props) {
  const clientCode = code ?? client?.ref ?? nextClientCode();
  const routeId = client ? (routes.find((route) => route.name === client.route)?.id ?? "") : "";
  const [photo, setPhoto] = useState<string | undefined>(client?.photo);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedRoute = routes.find((route) => route.id === String(form.get("ruta") ?? ""));
    onSave({
      name: String(form.get("nombre") ?? "").trim(),
      lastName: String(form.get("apellidos") ?? "").trim(),
      document: String(form.get("documento") ?? "").trim(),
      route: selectedRoute?.name ?? "",
      email: String(form.get("correo") ?? "").trim(),
      city: String(form.get("ciudad") ?? "").trim(),
      barrio: String(form.get("barrio") ?? "").trim(),
      address: String(form.get("direccion") ?? "").trim(),
      notes: String(form.get("observaciones") ?? "").trim(),
      photo,
    });
  }

  return (
    <form className="sheet" onSubmit={onSubmit}>
      <div className="sheet-body">
        <div className="sheet-fields">
          <div className="sheet-row split">
            <label className="sheet-label" htmlFor="cli-nombre">
              Nombre
            </label>
            <input
              id="cli-nombre"
              name="nombre"
              required
              placeholder="Nombre"
              autoComplete="given-name"
              defaultValue={client?.name}
            />
            <span className="sheet-label">Código cliente</span>
            <b className="sheet-code">{clientCode}</b>
          </div>

          <div className="sheet-row">
            <label className="sheet-label" htmlFor="cli-apellidos">
              Apellidos
            </label>
            <input
              id="cli-apellidos"
              name="apellidos"
              required
              placeholder="Apellidos"
              autoComplete="family-name"
              defaultValue={client?.lastName}
            />
          </div>

          <div className="sheet-row split">
            <label className="sheet-label" htmlFor="cli-documento">
              Documento
            </label>
            <input
              id="cli-documento"
              name="documento"
              required
              placeholder="Cédula"
              defaultValue={client?.document}
            />
            <label className="sheet-label" htmlFor="cli-ruta">
              Ruta / barrio
            </label>
            <select id="cli-ruta" name="ruta" required defaultValue={routeId}>
              <option value="" disabled>
                Seleccionar ruta
              </option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name} · {route.zone}
                </option>
              ))}
            </select>
          </div>

          <div className="sheet-row">
            <label className="sheet-label" htmlFor="cli-correo">
              Correo
            </label>
            <input
              id="cli-correo"
              name="correo"
              type="email"
              placeholder="opcional"
              autoComplete="email"
              defaultValue={client?.email}
            />
          </div>

          <div className="sheet-row split">
            <label className="sheet-label" htmlFor="cli-ciudad">
              Ciudad
            </label>
            <input id="cli-ciudad" name="ciudad" placeholder="Ciudad" defaultValue={client?.city} />
            <label className="sheet-label" htmlFor="cli-barrio">
              Barrio
            </label>
            <input id="cli-barrio" name="barrio" placeholder="Barrio" defaultValue={client?.barrio} />
          </div>

          <div className="sheet-row sheet-row-top">
            <label className="sheet-label" htmlFor="cli-direccion">
              Dirección
            </label>
            <textarea
              id="cli-direccion"
              name="direccion"
              rows={3}
              placeholder="Calle, número, referencias"
              defaultValue={client?.address}
            />
          </div>
        </div>

        <aside className="sheet-photos">
          <PhotoSlot id="cli-foto" title="Foto cliente" value={photo} onChange={setPhoto} />
          <PhotoSlot id="cli-sector" title="Sector / negocio" />
          <PhotoSlot id="cli-otro" title="Otro" />
        </aside>
      </div>

      <div className="sheet-row sheet-row-top sheet-note">
        <label className="sheet-label" htmlFor="cli-observaciones">
          Observaciones
        </label>
        <textarea
          id="cli-observaciones"
          name="observaciones"
          rows={4}
          placeholder="Nota interna, opcional"
          defaultValue={client?.notes}
        />
      </div>

      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn primary">
          Guardar
        </button>
      </div>
    </form>
  );
}

function PhotoSlot({
  id,
  title,
  value,
  onChange,
}: {
  id: string;
  title: string;
  value?: string;
  onChange?: (url: string | undefined) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [localUrl, setLocalUrl] = useState<string | undefined>();
  const photoUrl = value ?? localUrl;

  function onPhoto(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : undefined;
      if (onChange) onChange(result);
      else setLocalUrl(result);
    };
    reader.readAsDataURL(file);
  }

  function clearPhoto() {
    if (fileRef.current) fileRef.current.value = "";
    if (onChange) onChange(undefined);
    else setLocalUrl(undefined);
  }

  return (
    <div className="photo-slot">
      <input
        id={id}
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => onPhoto(event.target.files?.[0])}
      />
      <label htmlFor={id} className={photoUrl ? "photo-upload has-photo" : "photo-upload"}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={title} />
        ) : (
          <span>
            <CameraIcon />
            {title}
          </span>
        )}
      </label>
      {photoUrl ? (
        <button type="button" className="photo-clear" onClick={clearPhoto}>
          Quitar
        </button>
      ) : null}
    </div>
  );
}
