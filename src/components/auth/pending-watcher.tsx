"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { checkApprovalAction } from "@/app/actions/auth";

/** Polls for approval so the user does not have to guess when to reload. */
export function PendingWatcher() {
  const router = useRouter();
  const [isChecking, startCheck] = useTransition();
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const check = () =>
    startCheck(async () => {
      const { status } = await checkApprovalAction();
      setLastCheck(new Date());
      if (status === "approved") router.replace("/dashboard");
      else router.refresh();
    });

  useEffect(() => {
    const timer = setInterval(() => {
      void checkApprovalAction().then(({ status }) => {
        if (status === "approved") router.replace("/dashboard");
      });
    }, 20_000);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={check} disabled={isChecking} className="btn-secondary">
        {isChecking ? "Verificando…" : "Verificar agora"}
      </button>
      <p className="text-ink-400 text-xs">
        {lastCheck
          ? `Última verificação às ${lastCheck.toLocaleTimeString("pt-BR")}`
          : "Verificamos automaticamente a cada 20 segundos."}
      </p>
    </div>
  );
}
