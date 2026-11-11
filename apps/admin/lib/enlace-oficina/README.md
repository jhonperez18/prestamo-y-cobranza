# enlace-oficina

Estado del **enlace celular → autoprestamos.org** (puerta a Supabase).

## Qué mide

- `navigator.onLine`
- ¿El servidor contestó? (pull/flush / probe `/api/ops/build-health`)
- Cola Outbox pendiente

## Qué no mide

- Barritas de antena del chip (el navegador no las da).

## Estados

| Código | Barra |
| --- | --- |
| `ok` | Enlace · al día |
| `subiendo` | Enlace · subiendo N… |
| `sin_enlace` | Sin enlace · cobros quedan en el celular |

No bloquea cobros. Offline-first: el cobro queda en el celular y se sube solo.
