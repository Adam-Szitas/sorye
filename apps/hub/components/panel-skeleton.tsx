export function PanelSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl animate-pulse space-y-4 px-2">
      <div className="h-8 w-48 rounded-lg bg-white/10" />
      <div className="h-4 w-72 rounded bg-white/5" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function HubLoadingSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="glass h-14 shrink-0" />
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
      </div>
    </div>
  );
}
