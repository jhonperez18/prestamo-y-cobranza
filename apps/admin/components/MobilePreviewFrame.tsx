"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  title?: string;
};

export function MobilePreviewFrame({ children, title = "iPhone · vista cobrador" }: Props) {
  return (
    <div className="mobile-preview-wrap">
      <div className="mobile-preview-frame">
        <div className="mobile-preview-notch" aria-hidden />
        <div className="mobile-preview-status">
          <span>{title}</span>
          <span className="mobile-preview-signal">●●●</span>
        </div>
        <div className="mobile-preview-screen">{children}</div>
        <div className="mobile-preview-home" aria-hidden />
      </div>
    </div>
  );
}
