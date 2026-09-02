# Enfoque de navegación — sistema administrativo

Este documento define **solo el enfoque de interfaz** del sistema principal (computador / navegador). No es la PWA de cobradores.

La referencia visual se usó para entender jerarquía y densidad de información. El sidebar de variantes queda a la **izquierda**.

Prototipo clicable: [`../prototypes/admin-shell.html`](../prototypes/admin-shell.html)

---

## Principio

Tres capas. Nunca más de tres.

```
1. MÓDULO          botones en la barra superior
2. VARIANTE        grupos y acciones en el sidebar izquierdo
3. VISTA           listado, ficha, formulario o informe en el centro
```

El usuario siempre sabe dónde está:

`Clientes  →  Listado  →  Activos`

No se mezclan módulos en el mismo menú. Si una acción pertenece a otro módulo, se navega hacia ese módulo.

---

## Capa 1 — Barra superior (módulos)

Botones horizontales con icono + etiqueta. Representan **áreas de negocio**, no pantallas sueltas.

| Módulo | Para qué existe |
| --- | --- |
| Inicio | Resumen operativo del día |
| Clientes | Expediente de personas. El cliente es la entidad central |
| Préstamos | Contratos y condiciones históricas |
| Cartera | Saldos, mora, exposición |
| Cobranza | Pagos, abonos, anulaciones |
| Rutas | Organización del trabajo de campo |
| Cobradores | Personas que cobran, zonas, asignación |
| Reportes | Consultas y exportación |
| Sistema | Usuarios, roles, permisos, auditoría, configuración |

A la derecha de la barra, fijos:

- Búsqueda global (cliente, documento, préstamo)
- Usuario autenticado
- Cerrar sesión / perfil

En pantallas angostas la barra de módulos hace scroll horizontal. No se apilan en dos filas.

---

## Capa 2 — Sidebar izquierdo (variantes)

Al pulsar un módulo, el sidebar **cambia por completo**. Muestra solo las variantes de ese módulo.

Cada módulo organiza variantes en grupos. Ejemplo para **Clientes**:

```
CLIENTES
  Nuevo cliente
  Listado          ← vista por defecto
    Prospectos
    Pte. revisión
    Activos
    Inactivos

EXPEDIENTE
  Ficha
  Préstamos
  Historial
  Evidencias
```

Reglas:

- El primer ítem operativo del grupo principal se abre por defecto (casi siempre *Listado* o *Resumen*).
- Los filtros de estado (Activos, Mora, Pagada) son **variantes del listado**, no módulos nuevos.
- *Nuevo…* siempre está al inicio del grupo, no escondido.
- El sidebar no muestra módulos ajenos. Cobranza no aparece dentro de Clientes.
- El sidebar se puede plegar para ganar espacio de tabla. El estado se recuerda por usuario.

Por qué a la izquierda:

- Coincide con la lectura y con el hábito de ERPs (el menú de variantes se busca primero).
- El módulo activo (barra superior) y su desglose (sidebar) quedan juntos a la izquierda.
- El área de trabajo, más ancha, queda a la derecha para tablas y fichas.

---

## Capa 3 — Área de trabajo

Fondo sereno. Encima, un lienzo blanco para datos.

Estructura estable de casi todas las listas:

1. Título + conteo + botón crear
2. Barra de filtros (usuario, fechas, búsqueda, estado)
3. Tabla paginada
4. Estados como pastillas de color, no como texto suelto

Estados visuales (propuesta, no definitiva):

| Estado | Color | Uso |
| --- | --- | --- |
| Pagada / al día | Gris neutro | Completado, sin urgencia |
| Parcial / abono | Ámbar | Atención, no alarma |
| Pendiente | Naranja | Hay que actuar |
| Vencida / mora | Rojo | Prioridad |
| Anulado | Gris tachado | Histórico, no operable |

Nunca se cargan miles de filas. Paginación en servidor. Filtros en servidor.

---

## Mapa módulo → variantes

### Inicio

- Resumen
- Alertas
- Operación de hoy

### Clientes

- Nuevo cliente
- Listado (Prospectos, Pte. revisión, Activos, Inactivos)
- Ficha
- Historial
- Evidencias

### Préstamos

- Nuevo préstamo
- Listado (Borrador, Activos, Finalizados, Cancelados)
- Estado de cuenta
- Cuotas

### Cartera

- Resumen
- Mora
- Por cobrador
- Por ruta
- Saldos a favor *(si el comprador lo habilita)*

### Cobranza

- Cobros del día
- Pagos
- Abonos
- Anulaciones
- Comprobantes

### Rutas

- Nueva ruta
- Listado
- Ruta del día
- Asignar clientes

### Cobradores

- Nuevo cobrador
- Listado
- Zonas
- Actividad

### Reportes

- Cobros diarios
- Por cobrador
- Por ruta
- Cartera
- Mora
- Clientes / préstamos

### Sistema

- Usuarios
- Roles
- Permisos
- Auditoría
- Configuración

---

## Relación con la ficha del cliente

La ficha no es un módulo. Es una **vista profunda** dentro de Clientes.

Flujo:

```
Clientes (top)
  → Listado (sidebar)
    → clic en un cliente
      → Ficha (misma área de trabajo, sidebar marca “Ficha”)
        → pestañas internas: Datos, Préstamos, Estado de cuenta, Historial, Evidencias
```

Las pestañas internas de la ficha **no** se duplican como módulos del top bar.

---

## PWA (no usa este enfoque)

La PWA es otra interfaz, más simple:

- Pantalla principal: ruta del día
- Botones grandes
- Estados de color
- Una mano

No se replica la barra superior ni el sidebar izquierdo en el teléfono del cobrador.

---

## Lo que este prototipo no hace

- No calcula saldos.
- No guarda datos.
- No es el diseño final de cada formulario.
- No copia el producto de referencia; toma su jerarquía y la moderniza.

Cuando la arquitectura se apruebe, este enfoque se convierte en el layout real del admin (`apps/admin`).
