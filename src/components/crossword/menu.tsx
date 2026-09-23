"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ChevronDownIcon } from "@/components/icons";

export type MenuItem = {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * Minimal dropdown: closes on outside click, on Escape and after a selection.
 * Deliberately not a full menu widget — three buttons do not justify one.
 */
export function Menu({
  label,
  icon,
  items,
  className = "btn-secondary",
  align = "right",
  disabled,
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  items: MenuItem[];
  className?: string;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((previous) => !previous)}
        className={className}
      >
        {icon}
        {label}
        {label !== "" && (
          <ChevronDownIcon
            size={14}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && (
        <div
          id={id}
          role="menu"
          className={`card absolute z-50 mt-2 w-56 overflow-hidden p-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger ? "text-bad hover:bg-bad-soft" : "text-ink hover:bg-sunken"
              }`}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.hint && (
                <kbd className="border-line bg-paper text-ink-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">
                  {item.hint}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
