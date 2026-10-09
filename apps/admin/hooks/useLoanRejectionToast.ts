"use client";

import { useEffect, useRef } from "react";
import { LOAN_REJECTED_EVENT, type LoanRejection } from "@/lib/loan-rejections";

/** Orden de préstamo que la nube no aceptó (aunque haya subido en segundo plano) → aviso. */
export function useLoanRejectionToast(showToast: (message: string) => void) {
  const showRef = useRef(showToast);
  useEffect(() => {
    showRef.current = showToast;
  }, [showToast]);
  useEffect(() => {
    function onRejected(event: Event) {
      showRef.current((event as CustomEvent<LoanRejection>).detail.message);
    }
    window.addEventListener(LOAN_REJECTED_EVENT, onRejected);
    return () => window.removeEventListener(LOAN_REJECTED_EVENT, onRejected);
  }, []);
}
