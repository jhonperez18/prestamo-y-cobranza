"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_VIEW,
  groupForView,
  getViewLabel,
  type ModuleId,
} from "@/lib/navigation";
import { Icon, MenuIcon, SearchIcon, SidebarToggleIcon } from "@/components/icons";
import { Workspace } from "@/components/Workspace";
import type { AppSession } from "@/lib/auth";
import {
  canAccessView,
  defaultLandingForSession,
  filterModulesForSession,
} from "@/lib/session-access";
import { ThemeApplier } from "@/components/ThemeApplier";
import { readAdminProfile } from "@/lib/admin-profile";
import { useActionToast } from "@/hooks/useActionToast";

function groupKey(moduleId: ModuleId, title: string) {
  return `${moduleId}:${title}`;
}

type Props = {
  session: AppSession;
  onLogout: () => void;
  onSessionChange: (session: AppSession) => void;
  /** Celular: chrome compacto + menú cajón (admin usable en teléfono). */
  phoneLayout?: boolean;
};

export function AppShell({ session, onLogout, onSessionChange, phoneLayout = false }: Props) {
  const filteredModules = useMemo(() => filterModulesForSession(session), [session]);
  const landing = useMemo(() => defaultLandingForSession(session), [session]);

  const [moduleId, setModuleId] = useState<ModuleId>(landing.moduleId);
  const [viewId, setViewId] = useState(landing.viewId);
  const [asideOpen, setAsideOpen] = useState(!phoneLayout);
  const { showToast, toastNode } = useActionToast();
  const adminProfile = readAdminProfile(session.userRef, session.name, session.username);
  const displayName = adminProfile.displayName || session.name;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    "inicio:Usuario": false,
    "inicio:Rutas": false,
    "inicio:Pagos varios": false,
    "inicio:Control": false,
  });
  const [navBadges, setNavBadges] = useState<Record<string, string | undefined>>({});
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const current = filteredModules.find((entry) => entry.id === moduleId) ?? filteredModules[0];
  const viewLabel = getViewLabel(moduleId, viewId);
  const phonePreview = phoneLayout && viewId === "vista-movil";
  const sidebarView =
    (moduleId === "clientes" && (viewId === "ficha" || viewId === "editar")) ||
    (moduleId === "prestamos" && (viewId === "cuenta" || viewId === "editar")) ||
    (moduleId === "inicio" && (viewId === "ficha-usuario" || viewId === "editar-usuario" || viewId === "pagos-varios-editar" || viewId === "pagos-varios-ficha")) ||
    (moduleId === "cobranza" && viewId === "ficha-pago") ||
    (moduleId === "banco" && (viewId === "extracto" || viewId === "extracto-pendiente"))
      ? moduleId === "cobranza"
        ? "pagos"
        : moduleId === "banco"
          ? "registros"
          : moduleId === "inicio" && viewId === "pagos-varios-editar"
            ? "pagos-varios-listado"
          : moduleId === "inicio" && viewId === "pagos-varios-ficha"
            ? "pagos-varios-listado"
          : "listado"
      : viewId;

  function resolveView(nextModule: ModuleId, nextView?: string) {
    const mod = filteredModules.find((entry) => entry.id === nextModule);
    if (!mod) return landing.viewId;
    if (nextView && canAccessView(session, nextModule, nextView)) return nextView;
    return DEFAULT_VIEW[nextModule] ?? mod.groups[0]?.items[0]?.id ?? landing.viewId;
  }

  function go(nextModule: ModuleId, nextView?: string) {
    const mod = filteredModules.find((entry) => entry.id === nextModule);
    if (!mod) return;
    setModuleId(nextModule);
    setViewId(resolveView(nextModule, nextView));
    // En celular: solo cerrar el cajón al elegir una vista concreta (no al cambiar de módulo).
    if (phoneLayout && nextView) setAsideOpen(false);
  }

  function selectPhoneModule(nextModule: ModuleId) {
    const mod = filteredModules.find((entry) => entry.id === nextModule);
    if (!mod) return;
    setModuleId(nextModule);
    setViewId(resolveView(nextModule));
    setAsideOpen(true);
  }

  function exclusiveGroupState(title: string | null) {
    if (!current) return {};
    const next: Record<string, boolean> = {};
    for (const group of current.groups) {
      if (!group.collapsible) continue;
      const key = groupKey(moduleId, group.title);
      next[key] = title !== null && group.title === title;
    }
    return next;
  }

  function toggleGroup(title: string) {
    const key = groupKey(moduleId, title);
    const willOpen = !openGroups[key];
    if (willOpen) {
      setOpenGroups((currentState) => ({ ...currentState, ...exclusiveGroupState(title) }));
    } else {
      setOpenGroups((currentState) => ({ ...currentState, [key]: false }));
    }
  }

  function showDemoToast(message = "Vista de demostración. Los datos no se guardan todavía.") {
    showToast(message);
  }

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  useEffect(() => {
    const group = groupForView(moduleId, viewId);
    if (group?.collapsible) {
      setOpenGroups((currentState) => ({ ...currentState, ...exclusiveGroupState(group.title) }));
    }
  }, [moduleId, viewId]);

  useEffect(() => {
    if (!canAccessView(session, moduleId, viewId)) {
      setModuleId(landing.moduleId);
      setViewId(landing.viewId);
    }
  }, [session, moduleId, viewId, landing.moduleId, landing.viewId]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    setAsideOpen(!phoneLayout);
  }, [phoneLayout]);

  useEffect(() => {
    if (!phoneLayout || !asideOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setAsideOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [phoneLayout, asideOpen]);

  useEffect(() => {
    if (!phoneLayout || !asideOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phoneLayout, asideOpen]);

  function openProfile() {
    setUserMenuOpen(false);
    go("inicio", "perfil");
  }

  if (!current) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <p>Tu usuario no tiene módulos asignados en el panel web.</p>
          <button type="button" className="btn primary login-submit" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  const topbarClass = [
    asideOpen ? "topbar" : "topbar aside-off",
    phoneLayout ? "is-phone-layout" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const shellClass = [
    asideOpen ? "shell" : "shell aside-off",
    phoneLayout ? "is-phone-layout" : "",
    phonePreview ? "is-phone-preview" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <ThemeApplier />
      <header className={topbarClass}>
        <div className="topbar-brand">
          <div className="brand">
            <img src="/logo-ca-prestamo.png" alt="CA préstamo" className="brand-logo" />
          </div>
        </div>
        <div className="topbar-main">
          {phoneLayout ? (
            <div className="phone-topbar-bar">
              <button
                type="button"
                className="icon-btn phone-menu-btn"
                title="Menú"
                aria-label={asideOpen ? "Cerrar menú" : "Abrir menú"}
                aria-expanded={asideOpen}
                onClick={() => setAsideOpen((open) => !open)}
              >
                <MenuIcon />
              </button>
              <div className="phone-topbar-title">
                <strong>{current.label}</strong>
                <span>{viewLabel}</span>
              </div>
              <div className="topbar-user" ref={userMenuRef}>
                <button
                  type="button"
                  className="topbar-user-btn"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setUserMenuOpen((open) => !open)}
                >
                  <div className="avatar">
                    {adminProfile.photo ? (
                      <img src={adminProfile.photo} alt="" />
                    ) : (
                      initials
                    )}
                  </div>
                </button>
                {userMenuOpen ? (
                  <div className="topbar-user-menu" role="menu">
                    <button type="button" className="topbar-user-menu-item" role="menuitem" onClick={openProfile}>
                      Perfil
                    </button>
                    <button type="button" className="topbar-user-menu-item" role="menuitem" onClick={onLogout}>
                      Cerrar sesión
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <nav className="modules">
                {filteredModules.map((module) => (
                  <button
                    key={module.id}
                    className={module.id === moduleId ? "mod on" : "mod"}
                    onClick={() => go(module.id)}
                  >
                    <Icon name={module.icon} />
                    <em>{module.label}</em>
                  </button>
                ))}
              </nav>
              <div className="utils">
                <label className="search">
                  <SearchIcon />
                  <input placeholder="Cliente, cédula, préstamo…" />
                </label>
                <button
                  className="icon-btn"
                  title="Mostrar u ocultar variantes"
                  onClick={() => setAsideOpen((open) => !open)}
                >
                  <SidebarToggleIcon />
                </button>
                <div className="topbar-user" ref={userMenuRef}>
                  <button
                    type="button"
                    className="topbar-user-btn"
                    aria-expanded={userMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => setUserMenuOpen((open) => !open)}
                  >
                    <div className="avatar">
                      {adminProfile.photo ? (
                        <img src={adminProfile.photo} alt="" />
                      ) : (
                        initials
                      )}
                    </div>
                    <div className="topbar-user-text">
                      <strong>{displayName}</strong>
                      <span>
                        {session.roleName} · {session.username}
                      </span>
                    </div>
                    <span className="topbar-user-chevron" aria-hidden>
                      ▾
                    </span>
                  </button>
                  {userMenuOpen ? (
                    <div className="topbar-user-menu" role="menu">
                      <button type="button" className="topbar-user-menu-item" role="menuitem" onClick={openProfile}>
                        Perfil
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {phoneLayout && !phonePreview ? (
        <nav className="phone-module-rail" aria-label="Módulos">
          {filteredModules.map((module) => (
            <button
              key={module.id}
              type="button"
              className={module.id === moduleId ? "phone-mod on" : "phone-mod"}
              onClick={() => selectPhoneModule(module.id)}
            >
              <Icon name={module.icon} />
              <em>{module.label}</em>
            </button>
          ))}
        </nav>
      ) : null}

      {phoneLayout && asideOpen ? (
        <button
          type="button"
          className="phone-nav-scrim"
          aria-label="Cerrar menú"
          onClick={() => setAsideOpen(false)}
        />
      ) : null}

      <div className={shellClass}>
        <aside className="aside">
          {phoneLayout ? (
            <div className="phone-drawer-head">
              <strong>Vistas</strong>
              <button
                type="button"
                className="phone-drawer-close"
                aria-label="Cerrar menú"
                onClick={() => setAsideOpen(false)}
              >
                Cerrar
              </button>
            </div>
          ) : null}
          <div className="aside-body">
            {current.groups.map((group) => {
              const key = groupKey(moduleId, group.title);
              // En celular: lista abierta (sin submenús que se contraen).
              const isOpen = phoneLayout ? true : group.collapsible ? Boolean(openGroups[key]) : true;

              return (
                <div className={group.collapsible && !phoneLayout ? "group collapsible" : "group"} key={group.title}>
                  {group.collapsible && !phoneLayout ? (
                    <button
                      type="button"
                      className={isOpen ? "group-head group-toggle on" : "group-head group-toggle"}
                      onClick={() => toggleGroup(group.title)}
                      aria-expanded={isOpen}
                    >
                      <span className="group-chevron" aria-hidden>
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <Icon name={group.icon ?? "folder"} />
                      {group.title}
                    </button>
                  ) : (
                    <h3 className="group-head">
                      <Icon name="folder" /> {group.title}
                    </h3>
                  )}
                  {isOpen
                    ? group.items.map((item) => {
                        const dynamicBadge = navBadges[`${moduleId}:${item.id}`];
                        const badge = dynamicBadge ?? item.badge;
                        const soon = Boolean(item.soon);
                        return (
                          <button
                            key={item.id}
                            className={
                              item.id === sidebarView
                                ? soon
                                  ? "item on soon"
                                  : "item on"
                                : soon
                                  ? "item soon"
                                  : "item"
                            }
                            onClick={() => go(moduleId, item.id)}
                            title={soon ? "Próximamente — reservado para una fase posterior" : undefined}
                          >
                            <i className="dot" />
                            {item.label}
                            {soon ? <span className="badge badge-soon">próx.</span> : null}
                            {!soon && badge ? <span className="badge">{badge}</span> : null}
                          </button>
                        );
                      })
                    : null}
                </div>
              );
            })}
          </div>
          <div className="aside-footer">
            <button type="button" className="aside-logout" onClick={onLogout}>
              Cerrar sesión
            </button>
          </div>
        </aside>
        <main className="workspace">
          <Workspace
            moduleId={moduleId}
            viewId={viewId}
            viewLabel={viewLabel}
            moduleLabel={current.label}
            onGo={go}
            onToast={showDemoToast}
            onNavBadges={setNavBadges}
            adminName={displayName}
            session={session}
            onSessionChange={onSessionChange}
            sessionUserRef={session.userRef}
            sessionPermissions={session.permissions}
          />
        </main>
      </div>
      {toastNode}
    </>
  );
}
