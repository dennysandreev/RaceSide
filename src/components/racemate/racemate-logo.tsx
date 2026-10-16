import type { CSSProperties } from "react";

import { raceSideLogoArtwork } from "@/components/racemate/raceside-logo-artwork";
import { cn } from "@/lib/utils";

type RaceMateLogoProps = {
  className?: string;
  size?: "navigation" | "footer";
  variant?: "horizontal" | "signature";
};

type RaceMateMarkProps = {
  className?: string;
  plus?: boolean;
};

type RaceSideLogoSvgProps = {
  className?: string;
  palette?: "theme" | "dark" | "light" | "white";
  plus?: boolean;
  style?: CSSProperties;
  variant?: "horizontal" | "signature";
  width?: number;
};

const palettes = {
  theme: {
    mark: "var(--racemate-logo-mark)",
    wordmark: "var(--racemate-logo-wordmark)",
    descriptor: "var(--racemate-logo-descriptor)",
  },
  dark: { mark: "#E10600", wordmark: "#F5F4F2", descriptor: "#BDB8B6" },
  light: { mark: "#E10600", wordmark: "#191313", descriptor: "#6E5E5A" },
  white: { mark: "#FFFFFF", wordmark: "#FFFFFF", descriptor: "#FFFFFF" },
} as const;

export function RaceSideLogoSvg({
  className,
  palette = "theme",
  plus = false,
  style,
  variant = "horizontal",
  width = 208,
}: RaceSideLogoSvgProps) {
  const layout = plus ? raceSideLogoArtwork.plusLayouts[variant] : raceSideLogoArtwork.layouts[variant];
  const colors = palettes[palette];

  return (
    <svg
      aria-hidden="true"
      className={className}
      data-raceside-logo={plus ? `${variant}-plus` : variant}
      focusable="false"
      height={(width * layout.height) / layout.width}
      style={{ flexShrink: 0, ...style }}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill={colors.mark} transform={layout.markTransform}>
        {raceSideLogoArtwork.markPaths.map((d) => <path d={d} key={d} />)}
      </g>
      <g fill={colors.wordmark} transform={layout.wordmarkTransform}>
        {raceSideLogoArtwork.wordmarkPaths.map((path, index) => (
          <path d={path.d} key={index} transform={path.transform} />
        ))}
      </g>
      {variant === "signature" ? (
        <g fill={colors.descriptor} transform={raceSideLogoArtwork.layouts.signature.descriptorTransform}>
          {raceSideLogoArtwork.descriptorPaths.map((path, index) => (
            <path d={path.d} key={index} transform={path.transform} />
          ))}
        </g>
      ) : null}
      {plus ? (
        <g fill={colors.mark} transform={raceSideLogoArtwork.plusLayouts[variant].plusTransform}>
          {raceSideLogoArtwork.plusPaths.map((d) => <path d={d} key={d} />)}
        </g>
      ) : null}
    </svg>
  );
}

export function RaceMateLogo({ className, size = "navigation", variant = "horizontal" }: RaceMateLogoProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex max-w-full shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-active:translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
        size === "footer" ? "w-44" : "w-52",
        className,
      )}
    >
      <RaceSideLogoSvg className="block h-auto w-full" variant={variant} width={size === "footer" ? 176 : 208} />
    </span>
  );
}

export function RaceMateMark({ className, plus = false }: RaceMateMarkProps) {
  const mark = plus ? raceSideLogoArtwork.plusMark : raceSideLogoArtwork.mark;

  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0 text-[var(--racemate-logo-mark)]", className)}
      data-raceside-logo={plus ? "mark-plus" : "mark"}
      fill="currentColor"
      focusable="false"
      viewBox={`0 0 ${mark.width} ${mark.height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform={mark.transform}>
        {raceSideLogoArtwork.markPaths.map((d) => <path d={d} key={d} />)}
      </g>
      {plus ? (
        <g transform={raceSideLogoArtwork.plusMark.plusTransform}>
          {raceSideLogoArtwork.plusPaths.map((d) => <path d={d} key={d} />)}
        </g>
      ) : null}
    </svg>
  );
}
