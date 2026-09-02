type Props = {
  title?: string;
  detail?: string;
  onBack?: () => void;
};

export function AccessDenied({
  title = "Sin acceso",
  detail = "Tu rol no tiene permiso para ver esta sección.",
  onBack,
}: Props) {
  return (
    <section className="panel access-denied">
      <div className="head">
        <h1>{title}</h1>
      </div>
      <p className="access-denied-detail">{detail}</p>
      {onBack ? (
        <button type="button" className="btn" onClick={onBack}>
          Volver al inicio
        </button>
      ) : null}
    </section>
  );
}
