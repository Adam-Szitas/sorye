import type { SubscriptionPlan } from '@sorye/types';

interface SubscriptionBadgeProps {
  plan: SubscriptionPlan;
}

export function SubscriptionBadge({ plan }: SubscriptionBadgeProps) {
  return (
    <a
      href="/billing"
      title="Plan & billing"
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      style={{
        background: `${plan.accent}22`,
        color: plan.accent,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: plan.accent }}
        aria-hidden
      />
      {plan.name}
    </a>
  );
}
