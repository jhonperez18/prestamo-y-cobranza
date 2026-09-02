"use client";

import { useEffect } from "react";
import { applyUiPreferences } from "@/lib/ui-preferences";

export function ThemeApplier() {
  useEffect(() => {
    applyUiPreferences();
  }, []);

  return null;
}
