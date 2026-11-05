import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RISK_LABEL, type RiskLevel } from "@/lib/inventory";

export function Panel({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      className={cn("rise rounded-xl border border-line bg-surface shadow-sm", className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </section>
  );
}

export function PanelHead({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="font-display font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="font-mono text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Kpi({
  label,
  value,
  unit,
  hint,
  tone = "default",
  delay = 0,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: "default" | "accent" | "good" | "warn" | "info";
  delay?: number;
}) {
  const toneText = {
    default: "text-foreground",
    accent: "text-accent",
    good: "text-good",
    warn: "text-warn",
    info: "text-info",
  }[tone];
  return (
    <div
      className={cn("rise rounded-xl border border-line bg-surface p-4 shadow-sm")}
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-2 font-display text-[28px] font-semibold tracking-tight", toneText)}>
        {value}
        {unit && <span className="text-base font-medium text-muted-foreground"> {unit}</span>}
      </p>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const riskClasses: Record<RiskLevel, string> = {
  critico: "bg-destructive/10 text-destructive",
  alto: "bg-warn/15 text-warn",
  moderado: "bg-info/15 text-info",
  saludable: "bg-good/15 text-good",
};

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-1 text-center text-xs font-medium",
        riskClasses[level],
        className,
      )}
    >
      {RISK_LABEL[level]}
    </span>
  );
}

export function riskColorVar(level: RiskLevel) {
  return {
    critico: "var(--destructive)",
    alto: "var(--warn)",
    moderado: "var(--info)",
    saludable: "var(--good)",
  }[level];
}

export function Bar({ value, level }: { value: number; level: RiskLevel }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{ width: `${Math.min(100, value)}%`, background: riskColorVar(level) }}
      />
    </div>
  );
}

export function Tag({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "good" | "info" | "warn";
}) {
  const t = {
    muted: "bg-surface-2 text-muted-foreground",
    accent: "bg-accent/15 text-accent",
    good: "bg-good/15 text-good",
    info: "bg-info/15 text-info",
    warn: "bg-warn/15 text-warn",
  }[tone];
  return <span className={cn("rounded-md px-2 py-1 font-mono text-[11px]", t)}>{children}</span>;
}

export const money = (n: number) =>
  n.toLocaleString("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 });

export const moneyShort = (n: number) =>
  n >= 1_000_000
    ? `S/ ${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `S/ ${(n / 1000).toFixed(0)}k`
      : `S/ ${n.toFixed(0)}`;

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-1">
      <h1 className="font-display text-lg font-semibold tracking-tight">{title}</h1>
      <p className="font-mono text-[11px] uppercase text-muted-foreground">{subtitle}</p>
    </div>
  );
}
