"use client";

import { buildWelcomeLines, type WelcomeMessageConfig } from "@/lib/welcome-message";
import { fontFamilyStack } from "@/lib/ui-fonts";

type Props = {
  config: WelcomeMessageConfig;
  adminName: string;
  dateLabel: string;
  className?: string;
  preview?: boolean;
};

export function WelcomeBanner({ config, adminName, dateLabel, className, preview }: Props) {
  const { title, subtitle } = buildWelcomeLines(config, adminName, dateLabel);
  const animClass =
    config.animation === "none"
      ? ""
      : preview
        ? `welcome-anim-${config.animation} welcome-anim-live`
        : `welcome-anim-${config.animation}`;

  const bgStyle: React.CSSProperties = config.bgImage
    ? {
        backgroundImage: `linear-gradient(135deg, rgba(255,255,255,.82), rgba(255,255,255,.72)), url(${config.bgImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {
        background: `linear-gradient(135deg, #f7fbf8 0%, ${config.bgColor} 100%)`,
      };

  return (
    <header
      className={`home-welcome panel welcome-banner ${animClass}${className ? ` ${className}` : ""}`}
      style={bgStyle}
    >
      <div className="welcome-banner-copy">
        <h1
          style={{
            color: config.titleColor,
            fontSize: config.titleSize,
            fontWeight: config.titleWeight,
            fontFamily: fontFamilyStack(config.titleFont, "ui"),
          }}
        >
          {config.animation === "banner" ? (
            <span className="welcome-banner-marquee">
              <span>{title}</span>
            </span>
          ) : (
            title
          )}
        </h1>
        {subtitle ? (
          <p
            style={{
              color: config.subtitleColor,
              fontSize: config.subtitleSize,
              fontFamily: fontFamilyStack(config.subtitleFont, "ui"),
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {config.sideImage ? (
        <div className="welcome-banner-side">
          <img src={config.sideImage} alt="" />
        </div>
      ) : null}
    </header>
  );
}
