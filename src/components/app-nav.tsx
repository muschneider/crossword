"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BookIcon, GridIcon, HomeIcon, ShieldIcon } from "@/components/icons";

const LINKS = [
  { href: "/dashboard", label: "Início", Icon: HomeIcon, adminOnly: false },
  { href: "/crossword", label: "Crossword", Icon: GridIcon, adminOnly: false },
  { href: "/words", label: "Palavras", Icon: BookIcon, adminOnly: false },
  { href: "/admin/users", label: "Usuários", Icon: ShieldIcon, adminOnly: true },
];

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.filter((link) => !link.adminOnly || isAdmin).map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
              active ? "bg-ink text-paper" : "text-ink-soft hover:bg-sunken hover:text-ink"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
