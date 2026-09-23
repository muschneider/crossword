"use client";

import { MoonIcon, SunIcon } from "@/components/icons";
import { THEME_LABELS, THEMES, type Theme } from "@/lib/theme";
import { setTheme, useTheme } from "./use-theme";

const ICON: Record<Theme, typeof SunIcon> = { light: SunIcon, dark: MoonIcon };

/** Header shortcut: one click flips between light and dark. */
export function ThemeToggle({ initial, className = "" }: { initial: Theme; className?: string }) {
  const theme = useTheme(initial);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Usar o tema escuro" : "Usar o tema claro";
  // Shows where the click takes you, like most theme switches.
  const Icon = ICON[next];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={`btn-ghost px-2.5 ${className}`}
    >
      <Icon size={18} />
    </button>
  );
}

/** Profile setting: both options side by side, the current one pressed. */
export function ThemePicker({ initial }: { initial: Theme }) {
  const theme = useTheme(initial);

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="headline text-xl">Aparência</h2>
        <p className="text-ink-muted mt-1 text-xs">
          O tema claro é o padrão. A escolha vale para este aparelho.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Tema"
        className="border-line-strong bg-surface inline-flex rounded-xl border p-1"
      >
        {THEMES.map((value) => {
          const Icon = ICON[value];
          const checked = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => setTheme(value)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                checked ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              <Icon size={16} />
              {THEME_LABELS[value]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
