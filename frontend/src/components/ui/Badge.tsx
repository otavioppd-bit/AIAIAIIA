import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'primary' | 'positive' | 'negative' | 'warning' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-raised text-ink-muted border-line',
  primary: 'bg-primary-soft text-primary border-primary/20',
  positive: 'bg-positive/10 text-positive border-positive/25',
  negative: 'bg-negative/10 text-negative border-negative/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  info: 'bg-info/10 text-info border-info/25',
};

export function Badge({
  className,
  tone = 'neutral',
  icon,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; icon?: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {props.children}
    </span>
  );
}
