"use client";

import type { ReactNode } from "react";

export type QuadField = {
  label: string;
  value: string;
  money?: boolean;
  notes?: boolean;
};

function pairFields(fields: QuadField[]) {
  const pairs: [QuadField | null, QuadField | null][] = [];
  for (let index = 0; index < fields.length; index += 2) {
    pairs.push([fields[index] ?? null, fields[index + 1] ?? null]);
  }
  return pairs;
}

function renderCell(field: QuadField | null, kind: "label" | "value") {
  if (!field) return "";
  return kind === "label" ? field.label : field.value;
}

function valueClass(field: QuadField | null) {
  if (!field) return "loan-val-col";
  return `loan-val-col${field.money ? " money" : ""}${field.notes ? " loan-notes-val" : ""}`;
}

type Props = {
  title?: string;
  plainTitle?: boolean;
  code?: string;
  badge?: ReactNode;
  fields: QuadField[];
  footer?: ReactNode;
};

export function QuadDetailTable({ title, plainTitle, code, badge, fields, footer }: Props) {
  const pairs = pairFields(fields);

  return (
    <div className="mini-block loan-detail-compact">
      {title ? (
        plainTitle ? (
          <h2 className="detail-plain-title">{title}</h2>
        ) : (
          <div className="mini-head loan-detail-head">
            <h2>{title}</h2>
            {code ? <b className="sheet-code">{code}</b> : null}
            {badge}
          </div>
        )
      ) : null}

      <div className="table-wrap">
        <table className="data mini-grid loan-spec-table compact quad">
          <colgroup>
            <col className="loan-col-label" />
            <col className="loan-col-val" />
            <col className="loan-col-label" />
            <col className="loan-col-val" />
          </colgroup>
          <thead>
            <tr className="col-titles">
              <th className="loan-label-col">Concepto</th>
              <th className="loan-val-col">Detalle</th>
              <th className="loan-label-col">Concepto</th>
              <th className="loan-val-col">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map(([left, right], index) => (
              <tr key={`pair-${index}`}>
                <td className="loan-label-col">{renderCell(left, "label")}</td>
                <td className={valueClass(left)}>{renderCell(left, "value")}</td>
                <td className="loan-label-col">{renderCell(right, "label")}</td>
                <td className={valueClass(right)}>{renderCell(right, "value")}</td>
              </tr>
            ))}
            {footer}
          </tbody>
        </table>
      </div>
    </div>
  );
}
