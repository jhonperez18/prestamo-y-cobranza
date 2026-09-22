/**
 * Nombres de cliente: Primera mayúscula, resto minúsculas (es-CO).
 * Aplica a cada palabra (espacio o guion).
 */
export function toClientNameTitleCase(raw: string): string {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return "";
  return s
    .toLocaleLowerCase("es-CO")
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part) || part === "-") return part;
      return part.charAt(0).toLocaleUpperCase("es-CO") + part.slice(1);
    })
    .join("");
}

export function clientNameFieldsTitleCase<
  T extends { name?: string; lastName?: string; nickname?: string },
>(row: T): T {
  return {
    ...row,
    name: toClientNameTitleCase(row.name ?? ""),
    lastName: toClientNameTitleCase(row.lastName ?? ""),
    nickname: row.nickname !== undefined ? toClientNameTitleCase(row.nickname) : row.nickname,
  };
}
