'use client';

/** 5-step PO lifecycle stepper (Doc 4 §4.5.4). */
import { cn } from 'cn';
import { Check } from 'lucide-react';

const STEPS: ReadonlyArray<{ label: string }> = [
  { label: 'Draft' },
  { label: 'Submitted' },
  { label: 'Approved & Notified' },
  { label: 'Partially Received' },
  { label: 'Fully Received' },
];

function stepIndex(status: string): number {
  switch (status) {
    case 'DRAFT':
      return 0;
    case 'SUBMITTED':
      return 1;
    case 'APPROVED':
    case 'ORDERED':
      return 2;
    case 'PARTIALLY_RECEIVED':
      return 3;
    case 'RECEIVED':
      return 4;
    default:
      return 0;
  }
}

export function PoStatusStepper({ status }: { status: string }) {
  const active = stepIndex(status);
  const rejected = status === 'REJECTED' || status === 'CANCELLED';

  return (
    <ol className="flex flex-wrap items-center gap-2">
      {STEPS.map((step, index) => {
        const done = !rejected && index < active;
        const current = !rejected && index === active;
        return (
          <li key={step.label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-medium',
                done && 'border-primary bg-primary text-primary-foreground',
                current && 'border-primary text-primary',
                !done && !current && 'border-border text-muted-foreground',
                rejected && index === active && 'border-destructive text-destructive',
              )}
            >
              {done ? <Check className="h-3 w-3" /> : index + 1}
            </span>
            <span
              className={cn(
                'text-xs',
                current ? 'font-medium text-foreground' : 'text-muted-foreground',
                rejected && index === active && 'text-destructive',
              )}
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <span className="hidden h-px w-6 bg-border sm:block" aria-hidden />
            ) : null}
          </li>
        );
      })}
      {rejected ? (
        <li className="text-xs font-medium text-destructive">{status.replace(/_/g, ' ')}</li>
      ) : null}
    </ol>
  );
}
