"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { CameraIcon } from "@/components/icons";
import { nextClientCode, type ClientRow, type RouteRow } from "@/lib/mock-data";
import { clientsOnRouteSorted, nextRouteOrder } from "@/lib/client-route-order";

export type ClientDraft = {
  name: string;
  lastName: string;
  nickname: string;
  document: string;
  route: string;
  routeOrder: number;
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
  clients: ClientRow[];
  onCancel: () => void;
  onSave: (draft: ClientDraft) => void;
};

export function NewClientForm({
  client,
  code,
  routes,
  clients,
  onCancel,
  onSave,
}: Props) {
  const editing = Boolean(client);
  const clientCode = code ?? client?.ref ?? nextClientCode();
  const initialRouteId = client
    ? (routes.find((route) => route.name === client.route)?.id ?? "")
    : "";
  const [photo, setPhoto] = useState<string | undefined>(client?.photo);
  const [routeId, setRouteId] = useState(initialRouteId);
  const selectedRoute = routes.find((route) => route.id === routeId);
  const routeName = selectedRoute?.name ?? "";

  const positionOptions = useMemo(() => {
    if (!routeName) return [1];
    const onRoute = clientsOnRouteSorted(clients, routeName).filter(
      (row) => row.ref !== client?.ref,
    );
    const max = onRoute.length + 1;
    return Array.from({ length: max }, (_, index) => index + 1);
  }, [clients, routeName, client?.ref]);

  const defaultPosition = editing
    ? Math.min(client!.routeOrder || nextRouteOrder(clients, routeName), positionOptions.length)
    : positionOptions[positionOptions.length - 1] ?? 1;
  const [routeOrder, setRouteOrder] = useState(defaultPosition);

  function onRouteChange(nextId: string) {
    setRouteId(nextId);
    const nextName = routes.find((route) => route.id === nextId)?.name ?? "";
    const onRoute = clientsOnRouteSorted(clients, nextName).filter(
      (row) => row.ref !== client?.ref,
    );
    const append = onRoute.length + 1;
    setRouteOrder(append);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = routes.find((route) => route.id === String(form.get("ruta") ?? ""));
    if (!selected) return;
    const maxPos = positionOptions.length;
    const pos = Math.min(Math.max(1, Number(form.get("posicion")) || maxPos), maxPos);
    onSave({
      name: String(form.get("nombre") ?? "").trim(),
      lastName: String(form.get("apellidos") ?? "").trim(),
      nickname: String(form.get("apodo") ?? "").trim(),
      document: String(form.get("documento") ?? "").trim(),
      route: selected.name,
      routeOrder: pos,
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

          <div className="sheet-row split">
            <label className="sheet-label" htmlFor="cli-apellidos">
              Apellidos
            </label>
            <input
              id="cli-apellidos"
              name="apellidos"
              placeholder="Opcional"
              autoComplete="family-name"
              defaultValue={client?.lastName}
            />
            <label className="sheet-label" htmlFor="cli-apodo">
              Apodo
            </label>
            <input
              id="cli-apodo"
              name="apodo"
              placeholder="Opcional"
              defaultValue={client?.nickname ?? ""}
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
              Ruta
            </label>
            <select
              id="cli-ruta"
              name="ruta"
              required
              value={routeId}
              onChange={(event) => onRouteChange(event.target.value)}
            >
              <option value="" disabled>
                Seleccionar ruta
              </option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sheet-row split">
            <label className="sheet-label" htmlFor="cli-posicion">
              Posición en ruta
            </label>
            <select
              id="cli-posicion"
              name="posicion"
              required
              disabled={!routeId}
              value={routeOrder}
              onChange={(event) => setRouteOrder(Number(event.target.value))}
            >
              {!routeId ? (
                <option value="">Elija la ruta primero</option>
              ) : (
                positionOptions.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                    {pos === positionOptions.length ? " (al final)" : ""}
                  </option>
                ))
              )}
            </select>
            <span className="sheet-label sheet-label-hint">Consecutivo</span>
            <span className="sheet-hint">
              {routeId
                ? `Si elige ${routeOrder}, los que estaban desde ahí se corren +1.`
                : "Primero seleccione la ruta."}
            </span>
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
