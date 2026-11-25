import { useState } from "react";
import { useRouter } from "@tanstack/react-router";

/** Pantalla de inicio de sesión. Se muestra en cualquier ruta mientras no haya sesión. */
export function LoginScreen() {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "No se pudo iniciar sesión.");
        return;
      }
      setPassword("");
      await router.invalidate();
    } catch {
      setError("No hay conexión con el servidor.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-foreground">
      <form
        onSubmit={entrar}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6"
        aria-labelledby="titulo-login"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-accent font-display font-bold text-accent-foreground">
            IS
          </span>
          <div>
            <h1 id="titulo-login" className="font-display text-lg font-semibold tracking-tight">
              Intelli-Stock
            </h1>
            <p className="text-xs text-muted-foreground">Sistema multiagente de reposición</p>
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Usuario</span>
          <input
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoComplete="username"
            required
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-accent/10 px-3 py-2 text-[13px] text-accent">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-lg bg-accent py-2.5 font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {enviando ? "Ingresando…" : "Ingresar"}
        </button>
        <p className="font-mono text-[11px] leading-snug text-muted-foreground">
          ◆ Datos de demostración. Tras 5 intentos fallidos la cuenta se bloquea 15 minutos.
        </p>
      </form>
    </main>
  );
}
