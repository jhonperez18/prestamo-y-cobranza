"use client";

import { money, type ClientRow } from "@/lib/mock-data";
import { QuadDetailTable, type QuadField } from "@/components/QuadDetailTable";

type Props = {
  client: ClientRow;
};

export function ClientDetailTable({ client }: Props) {
  const fields: QuadField[] = [
    { label: "Documento", value: client.document || "—" },
    { label: "Correo", value: client.email || "—" },
    { label: "Ruta", value: client.route || "—" },
    { label: "Barrio", value: client.barrio || "—" },
    { label: "Estado", value: client.status },
  ];

  if (client.createdBy) {
    fields.push({ label: "Creado por", value: client.createdBy });
  }

  fields.push({
    label: "Observaciones",
    value: client.notes?.trim() || "—",
    notes: true,
  });

  return <QuadDetailTable title="Datos del cliente" plainTitle fields={fields} />;
}
