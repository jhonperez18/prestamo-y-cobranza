"use client";

import { PhoneMiniIcon } from "@/components/icons";
import { Pill } from "@/components/ui";
import {
  catalogRoutes,
  clientsOnRouteListed,
  collectorFieldStatus,
  money,
  type ActivityRow,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RoleRow,
  type RouteRow,
  type UserRow,
} from "@/lib/mock-data";
import { isOperationalClient } from "@/lib/client-review";
import {
  collectorProgramDays,
  dispatchRouteRef,
} from "@/lib/collector-dispatch-sync";
import { todayIso } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { defaultPermissionsForRole } from "@/lib/access-preview";
import { collectorDeleteGuard, collectorPayments, type CollectorTab, type DeleteGuard } from "@/lib/collector-preview";
import { CollectorActivityList } from "@/components/CollectorActivityList";
import { CollectorDailyHistory } from "@/components/CollectorDailyHistory";
import { CollectorPayForm } from "@/components/CollectorPayForm";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { PermissionChecklist } from "@/components/PermissionChecklist";
import type { CollectorDailyLogRow } from "@/lib/collector-daily-log";
import { normalizePaymentMethod, paymentMethodKind, paymentMethodLabel } from "@/lib/payment-method";
import type { CollectorPaymentDraft } from "@/lib/route-sync";
import { useEffect, useMemo, useState } from "react";

type PayContext = {
  routeRef: string;
  clientRef: string;
  loanRef: string;
  clientName: string;
  amountDue: number;
  chargeLabel?: string;
};

type Props = {
  collector: CollectorRow;
  tab: CollectorTab;
  routes: RouteRow[];
  clients: ClientRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  activities: ActivityRow[];
  dailyLogs: CollectorDailyLogRow[];
  dailyAssignments: DailyCollectionAssignment[];
  dayCloses?: import("@/lib/collector-day-close").CollectorDayCloseRecord[];
  dayExpenseDrafts?: import("@/lib/collector-day-close").CollectorDayExpenseDraft[];
  monthCloses?: import("@/lib/collector-day-close").CollectorMonthCloseRecord[];
  collectors: CollectorRow[];
  user?: UserRow | null;
  role?: RoleRow | null;
  confirmDelete: boolean;
  onTab: (tab: CollectorTab) => void;
  onEdit: () => void;
  onConfirmDelete: (value: boolean) => void;
  onDelete: () => void;
  onToggleActive: () => void;
  onSavePermissions?: (permissions: string[]) => void;
  onRegisterCollectorPayment?: (draft: CollectorPaymentDraft) => void;
  /** Vista del propio cobrador (app móvil). Oculta acciones de administración. */
  selfService?: boolean;
  allowedTabs?: CollectorTab[];
};

const TABS: { id: CollectorTab; label: string }[] = [
  { id: "ficha", label: "Ficha" },
  { id: "acceso", label: "Acceso móvil" },
  { id: "rutas", label: "Rutas" },
  { id: "cobros", label: "Cobros" },
  { id: "historial", label: "Historial" },
  { id: "actividad", label: "Actividad" },
];

export function CollectorFicha({
  collector,
  tab,
  routes,
  clients,
  loans,
  payments,
  activities,
  dailyLogs,
  dailyAssignments,
  dayCloses = [],
  dayExpenseDrafts = [],
  monthCloses = [],
  collectors,
  user,
  role,
  confirmDelete,
  onTab,
  onEdit,
  onConfirmDelete,
  onDelete,
  onToggleActive,
  onSavePermissions,
  onRegisterCollectorPayment,
  selfService = false,
  allowedTabs,
}: Props) {
  const [payContext, setPayContext] = useState<PayContext | null>(null);
  const permanentRoute = useMemo(
    () => catalogRoutes(routes).find((row) => row.collectorRef === collector.ref) ?? null,
    [routes, collector.ref],
  );
  const routeClientCount = useMemo(() => {
    if (!permanentRoute) return 0;
    return clientsOnRouteListed(permanentRoute.name, clients).filter(isOperationalClient).length;
  }, [permanentRoute, clients]);
  const programDays = collectorProgramDays(
    collector.ref,
    collector.name,
    dailyAssignments,
    routes,
    loans,
    clients,
  );
  const todayProgram = programDays.find((row) => row.date === todayIso());
  const todayDispatched = todayProgram?.dispatched ? todayProgram.items : [];
  const status = collectorFieldStatus(collector, routes);
  const collectorPay = collectorPayments(collector.ref, collectors, payments);
  const collectorActs = activities.filter((row) => row.collectorRef === collector.ref);
  const displayName = (user?.name ?? collector.name).trim() || collector.name;
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  const tabTitle = TABS.find((entry) => entry.id === tab)?.label ?? "Ficha";
  const visibleTabs = TABS.filter((entry) => {
    if (selfService && entry.id === "acceso") return false;
    if (allowedTabs?.length) return allowedTabs.includes(entry.id);
    return true;
  });
  const deleteGuard = collectorDeleteGuard(collector.ref, routes, payments, activities, collectors);
  const { canDelete } = deleteGuard;
  const [permissions, setPermissions] = useState<string[]>(
    user?.permissions?.length ? [...user.permissions] : defaultPermissionsForRole(role ?? null),
  );
  const [permDirty, setPermDirty] = useState(false);

  useEffect(() => {
    setPermissions(
      user?.permissions?.length ? [...user.permissions] : defaultPermissionsForRole(role ?? null),
    );
    setPermDirty(false);
  }, [user?.ref, role?.ref, user?.permissions?.join("|")]);

  const activityItems = [
    ...collectorActs.map((row) => ({
      ref: row.ref,
      when: row.when,
      title: row.label,
      detail: row.detail,
      kind: row.kind,
      gps: row.gps ?? false,
    })),
    ...collectorPay.map((row) => ({
      ref: row.ref,
      when: row.when,
      title: row.type,
      detail: `${row.client} · ${money(row.amount)}`,
      kind: row.kind,
      gps: true,
    })),
  ];

  return (
    <section className={selfService ? "panel collector-self" : "panel"}>
      {!selfService ? (
        <nav className="tabs">
          {visibleTabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={tab === entry.id ? "tab on" : "tab"}
              onClick={() => onTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="file-title">
        <h1>{tabTitle}</h1>
        <span className="sheet-code">{collector.ref}</span>
      </div>

      <div className="ficha">
        <aside className="ficha-side">
          <div className="photo">{initials}</div>
          <h2>{displayName}</h2>
          <p className="ficha-user-codes">
            <span className="ref">{user?.ref ?? "—"}</span>
            {" · "}
            <span className="ref">{collector.ref}</span>
          </p>
          <div className="meta">
            <div>
              <span>Teléfono</span>
              {collector.phone ? (
                <span className="cell-with-ico">
                  <PhoneMiniIcon />
                  {collector.phone}
                </span>
              ) : (
                "—"
              )}
            </div>
            <div>
              <span>Estado hoy</span>
              <Pill label={status.label} kind={status.kind} />
            </div>
            <div>
              <span>Programación</span>
              {programDays.length
                ? `${programDays.length} día${programDays.length === 1 ? "" : "s"}`
                : "Sin asignar"}
            </div>
            {todayDispatched.length ? (
              <div>
                <span>Cobros hoy</span>
                {todayDispatched.length} enviados
              </div>
            ) : todayProgram && !todayProgram.dispatched ? (
              <div>
                <span>Cobros hoy</span>
                {todayProgram.items.length} asignados
              </div>
            ) : null}
          </div>
        </aside>

        <div className="ficha-main">
          {tab === "ficha" ? (
            selfService ? (
              <p className="collector-self-hint">
                Bienvenido. Usa el menú superior para ver tu ruta, registrar cobros o revisar tu historial.
              </p>
            ) : (
            <div className="file-toolbar">
              <div className="file-toolbar-actions">
                {confirmDelete ? (
                  <>
                    <p className="ficha-warn">¿Eliminar este usuario? Saldrá del listado.</p>
                    <button type="button" className="btn-bar" onClick={() => onConfirmDelete(false)}>
                      Cancelar
                    </button>
                    <button type="button" className="btn-bar" onClick={onDelete}>
                      Sí, eliminar
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn-bar" onClick={onEdit}>
                      Modificar
                    </button>
                    {collector.active ? (
                      <button type="button" className="btn-bar" onClick={onToggleActive}>
                        Desactivar
                      </button>
                    ) : (
                      <button type="button" className="btn-bar" onClick={onToggleActive}>
                        Activar
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-bar"
                      disabled={!canDelete}
                      onClick={() => canDelete && onConfirmDelete(true)}
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
            )
          ) : null}

          {tab === "ficha" ? (
            <div className="access-panel">
              <div className="mini-block loan-detail-compact">
                <div className="mini-head loan-detail-head">
                  <h2>Datos del cobrador</h2>
                </div>
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
                      <tr>
                        <td className="loan-label-col">Documento</td>
                        <td className="loan-val-col">{collector.document || "—"}</td>
                        <td className="loan-label-col">Usuario móvil</td>
                        <td className="loan-val-col">
                          {collector.mobileAccess && collector.login ? collector.login : "Sin acceso"}
                        </td>
                      </tr>
                      <tr>
                        <td className="loan-label-col">Rol</td>
                        <td className="loan-val-col">{role?.name ?? "Cobrador"}</td>
                        <td className="loan-label-col">Cobertura</td>
                        <td className="loan-val-col">Todas las zonas</td>
                      </tr>
                      <tr>
                        <td className="loan-label-col">Ruta asignada</td>
                        <td className="loan-val-col" colSpan={3}>
                          {permanentRoute
                            ? `Ruta ${permanentRoute.name}${
                                routeClientCount
                                  ? ` · ${routeClientCount} cliente${routeClientCount === 1 ? "" : "s"}`
                                  : " · sin clientes"
                              }${
                                todayDispatched.length
                                  ? ` · ${todayDispatched.length} cobro${todayDispatched.length === 1 ? "" : "s"} hoy`
                                  : ""
                              }`
                            : todayProgram?.dispatched && todayProgram.route
                              ? `${todayProgram.route.name} · ${todayProgram.items.length} cobro${todayProgram.items.length === 1 ? "" : "s"} hoy`
                              : "Sin ruta asignada"}
                        </td>
                      </tr>
                      <tr>
                        <td className="loan-label-col">Cobrado</td>
                        <td className="loan-val-col money">
                          {collectorPay.length
                            ? money(collectorPay.reduce((sum, row) => sum + row.amount, 0))
                            : "—"}
                        </td>
                        <td className="loan-label-col">Notas</td>
                        <td className="loan-val-col loan-notes-val">{collector.notes || "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "acceso" ? (
            <div className="access-panel">
              <div className="mini-block loan-detail-compact">
                <div className="mini-head loan-detail-head">
                  <h2>Cuenta de acceso</h2>
                  <Pill
                    label={collector.mobileAccess && collector.active ? "Habilitado" : "Suspendido"}
                    kind={collector.mobileAccess && collector.active ? "ok" : "paid"}
                  />
                </div>
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
                      <tr>
                        <td className="loan-label-col">Código usuario</td>
                        <td className="loan-val-col ref">{user?.ref ?? "—"}</td>
                        <td className="loan-label-col">Correo / usuario</td>
                        <td className="loan-val-col">{collector.login ?? "—"}</td>
                      </tr>
                      <tr>
                        <td className="loan-label-col">Rol</td>
                        <td className="loan-val-col">{role?.name ?? "Cobrador"}</td>
                        <td className="loan-label-col">Canal</td>
                        <td className="loan-val-col">App móvil</td>
                      </tr>
                      <tr>
                        <td className="loan-label-col">Cobrador</td>
                        <td className="loan-val-col ref">{collector.ref}</td>
                        <td className="loan-label-col">Último acceso</td>
                        <td className="loan-val-col">{user?.lastAccess ?? "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mini-block access-perms-block">
                <div className="mini-head">
                  <h2>Permisos del usuario</h2>
                  <span className="mini-badge">{permissions.length}</span>
                </div>
                {user && onSavePermissions ? (
                  <>
                    <PermissionChecklist
                      role={role ?? null}
                      selected={permissions}
                      onChange={(next) => {
                        setPermissions(next);
                        setPermDirty(true);
                      }}
                    />
                    <div className="perm-checklist-actions">
                      <button
                        type="button"
                        className="btn primary"
                        disabled={!permDirty}
                        onClick={() => {
                          onSavePermissions(permissions);
                          setPermDirty(false);
                        }}
                      >
                        Guardar permisos
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="ficha-empty">Sin usuario móvil vinculado. Crea el acceso para asignar permisos.</p>
                )}
              </div>

              <p className="route-gps-note">
                Inicia sesión en la app móvil con su correo. Los permisos marcados definen qué puede hacer
                en campo según la confianza que le des.
              </p>
            </div>
          ) : null}

          {tab === "rutas" ? (
            programDays.length ? (
              <div className="route-dispatch-list">
                {programDays.map((day) => {
                  const route = day.route;
                  const rows = route?.stops.length
                    ? route.stops.map((stop) => ({
                        stop,
                        task: day.items.find(
                          (item) =>
                            item.loanRef === stop.loanRef && item.clientRef === stop.clientRef,
                        ),
                      }))
                    : day.items.map((item, index) => ({
                        stop: {
                          clientRef: item.clientRef,
                          visitOrder: index + 1,
                          loanRef: item.loanRef,
                          amountDue: item.amountDue,
                          visitStatus: item.visitStatus ?? "pendiente",
                        },
                        index,
                        task: item,
                      }));

                  return (
                    <div className="route-dispatch" key={day.date}>
                      <div className="route-dispatch-head">
                        <h3>
                          Programación · {day.dateLabel}{" "}
                          <span className="ref">{route?.ref ?? dispatchRouteRef(collector.ref, day.date)}</span>
                        </h3>
                        <Pill
                          label={
                            day.dispatched
                              ? route?.status ?? "Enviado"
                              : "Asignado · pendiente de envío"
                          }
                          kind={day.dispatched ? (route?.kind ?? "pending") : "draft"}
                        />
                      </div>
                      <p className="route-gps-note">
                        {day.dispatched
                          ? "Lista enviada desde Cobranza → Cobros del día. El cobrador la ve en el celular con cliente, monto y concepto."
                          : "Asignado en Cobros del día. Pulse Enviar a cobradores en Cobranza para publicarla en la app móvil."}
                      </p>
                      <table className="data mini-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Cliente</th>
                            <th>Zona</th>
                            <th>Concepto</th>
                            <th>Préstamo</th>
                            <th className="right">A cobrar</th>
                            <th>Estado</th>
                            {onRegisterCollectorPayment ? <th /> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ stop, task }) => {
                            const client = clients.find((row) => row.ref === stop.clientRef);
                            const visitLabel =
                              stop.visitStatus === "cobrado"
                                ? "Cobrado"
                                : stop.visitStatus === "parcial"
                                  ? "Parcial"
                                  : stop.visitStatus === "omitido"
                                    ? "Omitido"
                                    : day.dispatched
                                      ? "Pendiente"
                                      : "Asignado";
                            const visitKind =
                              stop.visitStatus === "cobrado"
                                ? "paid"
                                : stop.visitStatus === "parcial"
                                  ? "partial"
                                  : day.dispatched
                                    ? "pending"
                                    : "draft";
                            return (
                              <tr key={`${day.date}-${stop.clientRef}-${stop.loanRef}-${stop.visitOrder}`}>
                                <td>{stop.visitOrder}</td>
                                <td>
                                  {client ? `${client.name} ${client.lastName}` : task?.clientName ?? stop.clientRef}
                                  {task?.address ? (
                                    <em className="route-due-tag block">{task.address}</em>
                                  ) : null}
                                </td>
                                <td>{task?.clientRoute ?? client?.route ?? "—"}</td>
                                <td>{task?.chargeLabel ?? "—"}</td>
                                <td className="ref">{stop.loanRef ?? "—"}</td>
                                <td className="money right">
                                  {stop.amountDue > 0 ? money(stop.amountDue) : "—"}
                                </td>
                                <td>
                                  <Pill label={visitLabel} kind={visitKind} />
                                </td>
                                {onRegisterCollectorPayment ? (
                                  <td>
                                    {day.dispatched &&
                                    (stop.visitStatus === "pendiente" || stop.visitStatus === "parcial") &&
                                    stop.loanRef &&
                                    stop.amountDue > 0 ? (
                                      <button
                                        type="button"
                                        className="btn primary compact"
                                        onClick={() =>
                                          setPayContext({
                                            routeRef: route?.ref ?? dispatchRouteRef(collector.ref, day.date),
                                            clientRef: stop.clientRef,
                                            loanRef: stop.loanRef!,
                                            clientName: client
                                              ? `${client.name} ${client.lastName}`
                                              : task?.clientName ?? stop.clientRef,
                                            amountDue: stop.amountDue,
                                            chargeLabel: task?.chargeLabel,
                                          })
                                        }
                                      >
                                        Cobrar
                                      </button>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                ) : null}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="ficha-empty">
                Sin programación. En <strong>Cobranza → Cobros del día</strong> asigne cobros a este
                cobrador y pulse <strong>Enviar a cobradores</strong>.
              </p>
            )
          ) : null}

          {tab === "cobros" ? (
            <>
              <p className="route-gps-note">
                Cobros sincronizados desde campo. Cada pago también aparece en{" "}
                <strong>Cobranza → Pagos</strong> del sistema general.
              </p>
              {collectorPay.length ? (
              <table className="data mini-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th className="right">Valor</th>
                    <th>Forma de pago</th>
                    <th>Comprobante</th>
                    <th>Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {collectorPay.map((row) => (
                    <tr key={row.ref}>
                      <td className="ref">{row.ref}</td>
                      <td>{row.when}</td>
                      <td>{row.client}</td>
                      <td className="money right">{money(row.amount)}</td>
                      <td>
                        <Pill
                          label={paymentMethodLabel(row.method)}
                          kind={paymentMethodKind(normalizePaymentMethod(row.method))}
                        />
                      </td>
                      <td className="pay-evidence-cell">
                        <PaymentEvidenceThumb evidence={row.evidence} size={22} />
                      </td>
                      <td>{row.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="ficha-empty">Sin cobros registrados para este cobrador.</p>
            )}
            </>
          ) : null}

          {tab === "historial" ? (
            <CollectorDailyHistory
              collectorRef={collector.ref}
              collector={collector}
              dailyLogs={dailyLogs}
              payments={payments}
              activities={activities}
              routes={routes}
              dayCloses={dayCloses}
              dayExpenseDrafts={dayExpenseDrafts}
              monthCloses={monthCloses}
              assignments={dailyAssignments}
            />
          ) : null}

          {tab === "actividad" ? (
            <CollectorActivityList
              items={activityItems}
              emptyMessage="Sin actividad de campo registrada."
            />
          ) : null}
        </div>
      </div>

      {payContext && onRegisterCollectorPayment ? (
        <div className="collector-pay-sheet" role="dialog" aria-modal="true" aria-label="Cobro móvil">
          <button
            type="button"
            className="collector-pay-sheet-backdrop"
            aria-label="Cerrar"
            onClick={() => setPayContext(null)}
          />
          <div className="collector-pay-sheet-panel">
            <p className="collector-pay-sheet-tag">Vista app móvil</p>
            <CollectorPayForm
              clientName={payContext.clientName}
              amountDue={payContext.amountDue}
              chargeLabel={payContext.chargeLabel}
              onCancel={() => setPayContext(null)}
              onSubmit={(payload) => {
                onRegisterCollectorPayment({
                  idempotencyKey: payload.idempotencyKey,
                  routeRef: payContext.routeRef,
                  clientRef: payContext.clientRef,
                  loanRef: payContext.loanRef,
                  amount: payload.amount,
                  kind: payload.kind,
                  method: payload.method,
                  evidence: payload.evidence,
                  collectorRef: collector.ref,
                  collectorName: collector.name,
                  clientName: payContext.clientName,
                });
                setPayContext(null);
              }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
