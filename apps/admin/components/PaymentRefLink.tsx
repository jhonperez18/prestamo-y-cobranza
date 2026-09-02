"use client";

type Props = {
  refCode: string;
  onOpen: (ref: string) => void;
};

export function PaymentRefLink({ refCode, onOpen }: Props) {
  return (
    <button type="button" className="btn-link ref" onClick={() => onOpen(refCode)}>
      {refCode}
    </button>
  );
}
