import type { ReactNode } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { BuildStatus } from '../lib/types';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-mute font-mono text-sm">
      <Loader2 className="h-4 w-4 animate-spin text-droid" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <button onClick={onRetry} className="underline">Retry</button>}
    </div>
  );
}

const STATUS: Record<BuildStatus, string> = {
  queued: 'text-amber border-amber/40 bg-amber/10',
  running: 'text-sky border-sky/40 bg-sky/10',
  success: 'text-droid border-droid/40 bg-droid/10',
  failed: 'text-danger border-danger/40 bg-danger/10',
  cancelled: 'text-mute border-line bg-panel2',
};

export function StatusBadge({ status }: { status: BuildStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${STATUS[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === 'running' || status === 'queued' ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  );
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-droid">{kicker}</div>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-xl border border-line bg-panel2 text-droid">{icon}</div>
      <div className="font-display text-lg font-semibold">{title}</div>
      <p className="mt-1 max-w-sm text-sm text-mute">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
