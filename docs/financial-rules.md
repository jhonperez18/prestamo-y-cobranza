# Reglas financieras

**Ninguna fórmula de este archivo es definitiva.**  
El motor (`packages/financial-engine`) no aplicará reglas de interés, mora, sobrepago o refinanciación hasta que el comprador las apruebe por escrito aquí.

---

## Fuente de verdad

El backend llama al motor. El motor lee el préstamo, sus `loan_terms` históricos y las cuotas. Devuelve:

- asignaciones por cuota
- nuevos estados
- eventos para auditoría

La PWA y el admin **muestran** el resultado. No lo calculan.

---

## Comportamientos que SÍ se pueden implementar sin fórmula de interés

Estos no inventan tasa; solo registran caja contra cuotas ya existentes.

### Pago exacto

- Cuota programada: 10.000  
- Recibido: 10.000  
- Resultado propuesto: cuota `paid`, saldo de cuota 0.

### Abono (parcial)

- Cuota: 10.000  
- Recibido: 5.000  
- Resultado propuesto: cuota `partial`, pagado 5.000, pendiente 5.000.

### Pago completo de varias cuotas vencidas

**Pendiente:** ¿se aplica a la más antigua primero? (propuesta técnica: sí, FIFO por `due_date`). Confirmar.

---

## Comportamientos BLOQUEADOS hasta aprobación

### Pago superior a lo pendiente de la cuota (o del préstamo)

Ejemplo: cuota 10.000, recibido 15.000.

Opciones que el comprador debe elegir **una**:

1. Rechazar el excedente e informar.
2. Aplicar a la siguiente cuota.
3. Dejar saldo a favor del cliente.
4. Otra regla escrita por el negocio.

Hasta entonces el API responde `RULE_NOT_DEFINED`.

### Interés, mora, días de gracia, redondeo

Variables a definir:

- Tasa y base (30 días, 365, calendario).
- Interés sobre saldo vs. cuota pactada fija.
- Mora: ¿suma fija, % diario, tope?
- ¿La mora se capitaliza?
- Redondeo: hacia arriba, bancario, a peso entero.

### Cancelación anticipada, refinanciación, renovación

No hay tablas ni pantallas de estos productos hasta existir la regla.

### Anulación

Propuesta técnica (sí se puede acordar ya):

- El pago queda `voided`.
- Se revierten asignaciones en la misma transacción.
- Queda motivo, usuario, fecha.
- No se borra el registro.

Confirmar si hace falta doble aprobación.

---

## Plantilla para cada regla aprobada

Cuando una regla se apruebe, documentarla así:

```
Nombre:
Fórmula:
Variables:
Ejemplo normal:
Ejemplo extremo:
Redondeo:
Fecha de aprobación:
No aplica a préstamos creados antes de: (si aplica)
```

Los préstamos ya desembolsados siguen sus `loan_terms`. Una regla nueva no los reescribe.
