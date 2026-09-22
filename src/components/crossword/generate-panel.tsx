"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { generateCrosswordAction } from "@/app/actions/crossword";
import { SparkIcon } from "@/components/icons";

export function GenerateButton({
  disabled,
  label = "Gerar novo crossword",
  className = "btn-primary",
}: {
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await generateCrosswordAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <button onClick={onClick} disabled={disabled || isPending} className={className}>
        <SparkIcon className={`h-[18px] w-[18px] ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Gerando (pode levar alguns segundos)…" : label}
      </button>

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
