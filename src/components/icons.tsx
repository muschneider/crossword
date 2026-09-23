import type { SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  /** Rendered size in pixels, applied to both axes. */
  size?: number;
};

/** Shared skeleton for the stroked line icons. */
function Stroked({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function GoogleIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden {...props}>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.28a12 12 0 0 0 0 10.77l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4.01 3.1C6.23 6.87 8.88 4.75 12 4.75Z"
      />
    </svg>
  );
}

/** The brand mark: a 3×3 corner of a printed crossword. */
export function LogoMark({ size = 28, ...props }: IconProps) {
  const cells: [number, number, boolean][] = [
    [0, 0, false],
    [1, 0, false],
    [2, 0, true],
    [0, 1, false],
    [1, 1, true],
    [2, 1, false],
    [0, 2, true],
    [1, 2, false],
    [2, 2, false],
  ];
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} aria-hidden {...props}>
      {/* The "paper" of the tile follows the theme; the ink is currentColor. */}
      <rect x="0.75" y="0.75" width="28.5" height="28.5" rx="3" className="fill-surface" stroke="currentColor" strokeWidth="1.5" />
      {cells.map(([col, row, filled]) =>
        filled ? (
          <rect key={`${col}-${row}`} x={1.5 + col * 9} y={1.5 + row * 9} width="9" height="9" fill="currentColor" />
        ) : null,
      )}
      <path d="M10.5 1.5v27M19.5 1.5v27M1.5 10.5h27M1.5 19.5h27" stroke="currentColor" strokeWidth="1" />
      <text x="4.1" y="9" fontSize="6.5" fontWeight="700" fontFamily="ui-sans-serif, system-ui" fill="currentColor">
        M
      </text>
    </svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </Stroked>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </Stroked>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M9 22V12h6v10" />
    </Stroked>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </Stroked>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </Stroked>
  );
}

export function TrashIcon({ size = 16, ...props }: IconProps) {
  return (
    <Stroked size={size} {...props}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </Stroked>
  );
}

export function PencilIcon({ size = 16, ...props }: IconProps) {
  return (
    <Stroked size={size} {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Stroked>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="m20 6-11 11-5-5" />
    </Stroked>
  );
}

export function BulbIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="M9 18h6M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2Z" />
    </Stroked>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Stroked>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="m15 18-6-6 6-6" />
    </Stroked>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="m9 18 6-6-6-6" />
    </Stroked>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="m6 9 6 6 6-6" />
    </Stroked>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </Stroked>
  );
}

export function RotateIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </Stroked>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0Z" />
      <path d="M7 6H5a2 2 0 0 0 2 4M17 6h2a2 2 0 0 1-2 4" />
    </Stroked>
  );
}

export function FlameIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1-.4-2-1-3 2 1 4 3.5 4 6a6 6 0 0 1-12 0c0-5 5-7 6-12Z" />
    </Stroked>
  );
}

export function TargetIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </Stroked>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Stroked>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
    </Stroked>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Stroked {...props}>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </Stroked>
  );
}
