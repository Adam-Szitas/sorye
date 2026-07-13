import type { SubscriptionPlan } from '@sorye/types';

interface SubscriptionBadgeProps {
  plan: SubscriptionPlan;
}

export function SubscriptionBadge({ plan }: SubscriptionBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
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
    </span>
  );
}
