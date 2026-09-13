import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { sessionFromUser, type AppSession } from "@/lib/auth";
import { loadDemoUsers } from "@/lib/demo-persist";
import { USERS, type UserRow } from "@/lib/mock-data";

/**
 * Email Auth → login de negocio.
 * Ampliar aquí cuando crees usuarios en Supabase Auth Authentication → Users.
 */
const AUTH_EMAIL_TO_LOGIN: Record<string, string> = {
  "jhonefe18@yahoo.es": "truqui",
  "truqui@nexo.com": "truqui",
  "supervisor@nexo.com": "supervisor",
  "juan.rios@nexo.com": "juan.rios",
  "lina.soto@nexo.com": "lina.soto",
  "diego.mora@nexo.com": "diego.mora",
};

function looksLikeEmail(value: string) {
  return value.includes("@");
}

function findBusinessUser(email: string): UserRow | null {
  const login = AUTH_EMAIL_TO_LOGIN[email.trim().toLowerCase()];
  const users = loadDemoUsers();
  const pool = users.length ? users : USERS;
  if (login) {
    return pool.find((row) => row.login.toLowerCase() === login) ?? null;
  }
  return (
    pool.find((row) => (row.email || "").toLowerCase() === email.trim().toLowerCase()) ??
    null
  );
}

function roleIdFromUser(user: UserRow): string {
  if (user.login === "truqui" || user.roleRef === "ROL-0") return "admin";
  if (user.login === "supervisor" || user.roleRef === "ROL-2") return "supervisor";
  return "cobrador";
}

/** Persiste puente Auth → negocio (tabla profiles). Best-effort. */
async function upsertProfileFromAuth(userId: string, business: UserRow) {
  try {
    const supabase = createSupabaseBrowserClient();
    await supabase.from("profiles").upsert(
      {
        id: userId,
        login: business.login,
        user_ref: business.ref,
        collector_ref: business.collectorRef ?? null,
        role_id: roleIdFromUser(business),
        display_name: business.name,
        active: business.active,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  } catch {
    /* el login de negocio ya quedó; profile se completa con service role luego */
  }
}

/**
 * Login con Supabase Auth (email + password).
 * Devuelve sesión de negocio si el email está vinculado a un usuario del sistema.
 */
export async function loginWithSupabaseAuth(
  email: string,
  password: string,
): Promise<{ ok: true; session: AppSession } | { ok: false; error: string }> {
  if (!getSupabasePublicEnv().configured) {
    return { ok: false, error: "Supabase no configurado" };
  }

  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    return {
      ok: false,
      error: error?.message === "Invalid login credentials"
        ? "Usuario o contraseña incorrectos."
        : error?.message || "No se pudo iniciar sesión.",
    };
  }

  const business = findBusinessUser(data.user.email || email);
  if (!business || !business.active) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: "Cuenta Auth sin perfil en el sistema. Avisa al administrador.",
    };
  }

  await upsertProfileFromAuth(data.user.id, business);

  const session = sessionFromUser(business);
  return {
    ok: true,
    session: {
      ...session,
      username: data.user.email || session.username,
      name: business.name || data.user.email || session.name,
    },
  };
}

export async function signOutSupabaseAuth() {
  if (!getSupabasePublicEnv().configured) return;
  try {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
}

export function shouldTrySupabaseLogin(username: string) {
  return getSupabasePublicEnv().configured && looksLikeEmail(username);
}

/** Si escribe login corto (juan.rios), prueba email de negocio @nexo.com vía Auth. */
export function authEmailFromLoginHint(username: string): string | null {
  const raw = username.trim().toLowerCase();
  if (looksLikeEmail(raw)) return raw;
  const mapped = Object.entries(AUTH_EMAIL_TO_LOGIN).find(([, login]) => login === raw);
  return mapped ? mapped[0] : null;
}
