import type { ColumnOption } from "@/components/ColumnPicker";

export const COBRANZA_PAYMENT_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "fecha", label: "Fecha" },
  { id: "hora", label: "Hora" },
  { id: "cliente", label: "Cliente" },
  { id: "cobrador", label: "Cobrador" },
  { id: "valor", label: "Valor" },
  { id: "method", label: "Forma de pago" },
  { id: "evidence", label: "Comprobante" },
  { id: "ruta", label: "Ruta" },
  { id: "estado", label: "Estado" },
];

export const COBRANZA_PAYMENT_DEFAULT_COLS = COBRANZA_PAYMENT_COLUMNS.map((col) => col.id);

export const HOME_TODAY_MOVEMENT_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "when", label: "Hora" },
  { id: "client", label: "Cliente" },
  { id: "collector", label: "Cobrador" },
  { id: "amount", label: "Valor" },
  { id: "type", label: "Tipo" },
  { id: "status", label: "Estado" },
];

export const HOME_TODAY_MOVEMENT_DEFAULT_COLS = HOME_TODAY_MOVEMENT_COLUMNS.map((col) => col.id);

export const PRESTAMO_LIST_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "client", label: "Cliente" },
  { id: "date", label: "Desembolso" },
  { id: "capital", label: "Capital" },
  { id: "installment", label: "Valor cuota" },
  { id: "balance", label: "Saldo" },
  { id: "status", label: "Estado" },
];

export const PRESTAMO_LIST_DEFAULT_COLS = PRESTAMO_LIST_COLUMNS.map((col) => col.id);

export const BANK_RECORD_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "description", label: "Descripción" },
  { id: "method", label: "Método" },
  { id: "valueDate", label: "Fecha valor" },
  { id: "account", label: "Cuenta" },
  { id: "thirdParty", label: "Tercero" },
  { id: "debit", label: "Debe" },
  { id: "credit", label: "Haber" },
  { id: "balance", label: "Saldo" },
  { id: "extract", label: "Extracto" },
];

export const BANK_RECORD_DEFAULT_COLS = BANK_RECORD_COLUMNS.map((col) => col.id);

export const BANK_ACCOUNT_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "name", label: "Etiqueta" },
  { id: "type", label: "Tipo" },
  { id: "bank", label: "Banco" },
  { id: "number", label: "Número" },
  { id: "pending", label: "Registro a conciliar" },
  { id: "balance", label: "Saldo" },
  { id: "status", label: "Estado" },
];

export const BANK_ACCOUNT_DEFAULT_COLS = BANK_ACCOUNT_COLUMNS.map((col) => col.id);

export const BANK_EXTRACT_MOVEMENT_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "description", label: "Descripción" },
  { id: "method", label: "Método" },
  { id: "valueDate", label: "Fecha valor" },
  { id: "thirdParty", label: "Tercero" },
  { id: "debit", label: "Debe" },
  { id: "credit", label: "Haber" },
  { id: "balance", label: "Saldo" },
  { id: "extract", label: "Extracto", pickerHidden: true },
  { id: "actions", label: "Acciones", pickerHidden: true },
];

export const BANK_EXTRACT_MOVEMENT_DEFAULT_COLS = BANK_EXTRACT_MOVEMENT_COLUMNS.map((col) => col.id);

export const BANK_EXTRACT_COLUMNS: ColumnOption[] = [
  { id: "period", label: "Ref." },
  { id: "opening", label: "Saldo inicial" },
  { id: "closing", label: "Saldo final" },
  { id: "actions", label: "Acciones", pickerHidden: true },
];

export const BANK_EXTRACT_DEFAULT_COLS = BANK_EXTRACT_COLUMNS.map((col) => col.id);

export const MISC_PAYMENT_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "label", label: "Etiqueta" },
  { id: "paidDate", label: "Fecha pago" },
  { id: "account", label: "Cuenta bancaria" },
  { id: "method", label: "Forma de pago" },
  { id: "amount", label: "Importe" },
  { id: "status", label: "Estado" },
  { id: "actions", label: "Acciones", pickerHidden: true },
];

export const MISC_PAYMENT_DEFAULT_COLS = MISC_PAYMENT_COLUMNS.map((col) => col.id);

export const USER_LIST_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Código" },
  { id: "login", label: "Usuario" },
  { id: "email", label: "Correo" },
  { id: "name", label: "Nombre" },
  { id: "document", label: "Documento" },
  { id: "phone", label: "Teléfono" },
  { id: "role", label: "Rol / canal" },
  { id: "collector", label: "Cobrador" },
  { id: "lastAccess", label: "Último acceso" },
  { id: "status", label: "Estado" },
];

export const USER_LIST_DEFAULT_COLS = [
  "ref",
  "login",
  "name",
  "phone",
  "role",
  "collector",
  "lastAccess",
  "status",
];

export const BANK_LEDGER_INCOME_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "description", label: "Descripción" },
  { id: "method", label: "Método" },
  { id: "valueDate", label: "Fecha valor" },
  { id: "period", label: "Periodo" },
  { id: "account", label: "Cuenta" },
  { id: "thirdParty", label: "Tercero" },
  { id: "status", label: "Estado" },
  { id: "debit", label: "Debe" },
];

export const BANK_LEDGER_INCOME_DEFAULT_COLS = BANK_LEDGER_INCOME_COLUMNS.map((col) => col.id);

export const BANK_LEDGER_EXPENSE_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "description", label: "Descripción" },
  { id: "valueDate", label: "Fecha valor" },
  { id: "period", label: "Periodo" },
  { id: "account", label: "Cuenta" },
  { id: "thirdParty", label: "Tercero" },
  { id: "category", label: "Categoría" },
  { id: "status", label: "Estado" },
  { id: "credit", label: "Haber" },
];

export const BANK_LEDGER_EXPENSE_DEFAULT_COLS = BANK_LEDGER_EXPENSE_COLUMNS.map((col) => col.id);

export const DAILY_COLLECTION_COLUMNS: ColumnOption[] = [
  { id: "index", label: "#" },
  { id: "client", label: "Cliente" },
  { id: "zone", label: "Ruta" },
  { id: "loan", label: "Préstamo" },
  { id: "concept", label: "Concepto" },
  { id: "since", label: "Desde" },
  { id: "amount", label: "A cobrar" },
  { id: "status", label: "Estado" },
  { id: "collector", label: "Cobrador" },
  { id: "action", label: "Acción", pickerHidden: true },
];

export const DAILY_COLLECTION_DEFAULT_COLS = DAILY_COLLECTION_COLUMNS.map((col) => col.id);

export const CARTERA_MORA_COLUMNS: ColumnOption[] = [
  { id: "client", label: "Cliente" },
  { id: "loan", label: "Préstamo" },
  { id: "route", label: "Ruta" },
  { id: "days", label: "Días" },
  { id: "cuotas", label: "Cuotas" },
  { id: "balance", label: "Saldo" },
  { id: "status", label: "Estado" },
];

export const CARTERA_MORA_DEFAULT_COLS = CARTERA_MORA_COLUMNS.map((col) => col.id);

export const CARTERA_RESUMEN_LOAN_COLUMNS: ColumnOption[] = [
  { id: "client", label: "Cliente" },
  { id: "loan", label: "Préstamo" },
  { id: "route", label: "Ruta" },
  { id: "balance", label: "Saldo" },
  { id: "status", label: "Estado" },
];

export const CARTERA_RESUMEN_LOAN_DEFAULT_COLS = CARTERA_RESUMEN_LOAN_COLUMNS.map((col) => col.id);

export const CARTERA_RESUMEN_PAYMENT_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Ref." },
  { id: "fecha", label: "Fecha" },
  { id: "client", label: "Cliente" },
  { id: "collector", label: "Cobrador" },
  { id: "amount", label: "Valor" },
  { id: "type", label: "Tipo" },
];

export const CARTERA_RESUMEN_PAYMENT_DEFAULT_COLS = CARTERA_RESUMEN_PAYMENT_COLUMNS.map((col) => col.id);
