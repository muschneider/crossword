/**
 * Shared shape for every `useActionState` form in the app.
 *
 * This lives outside the `"use server"` files on purpose: those modules may
 * only export async functions, so exporting the idle constant from them makes
 * Next.js throw "A use server file can only export async functions, found
 * object" as soon as a Server Component imports the module.
 */
export type ActionState = {
  ok: boolean;
  message: string;
  /** Extra lines rendered under the message (parse warnings, etc). */
  details?: string[];
};

export const IDLE_STATE: ActionState = { ok: false, message: "" };

/**
 * `redirect()` and `notFound()` signal themselves by throwing. Swallowing those
 * in a catch block turns a navigation into the literal error text
 * "NEXT_REDIRECT" rendered inside the form, so they must be re-thrown.
 */
function isControlFlowError(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === "string" && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR)/.test(digest);
}

export function actionFailure(error: unknown): ActionState {
  if (isControlFlowError(error)) throw error;
  return { ok: false, message: error instanceof Error ? error.message : "Erro inesperado." };
}
