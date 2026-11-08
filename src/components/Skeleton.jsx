export default function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-bun-700/40 rounded-xl ${className}`} />
}

export function SkeletonText({ lines = 1, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  )
}

// ——— Page-shaped skeletons (Landry, 2026-11-08) ———
// Every wait shows the SHAPE of what is coming, in the panel
// tone, never a spinner floating in empty space. Built on the
// original Skeleton block above; reduced-motion users get the
// still shapes (motion-reduce on the pulse).

export function Skel({ className = '' }) {
  return <div aria-hidden="true" className={`rounded-lg bg-white/[0.06] animate-pulse motion-reduce:animate-none ${className}`} />
}

// The generic page shape — the Suspense fallback for every lazy
// view: a title, one big card, then rows.
export function PageSkeleton({ label }) {
  return (
    <div role="status" className="space-y-5 max-w-3xl mx-auto">
      {label && <span className="sr-only">{label}</span>}
      <Skel className="h-7 w-44" />
      <Skel className="h-36 w-full rounded-3xl" />
      <div className="space-y-3">
        <Skel className="h-16 w-full rounded-2xl" />
        <Skel className="h-16 w-full rounded-2xl" />
        <Skel className="h-16 w-full rounded-2xl" />
      </div>
    </div>
  )
}

// List rows — dictionary results, queue lists, shelves.
export function RowsSkeleton({ rows = 5 }) {
  return (
    <div role="status" className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-[#151129] border border-white/5 px-4 py-3.5 space-y-2">
          <Skel className="h-4 w-32" />
          <Skel className="h-3 w-56 max-w-full" />
        </div>
      ))}
    </div>
  )
}

// One big card with an action row — the flashcard deck shape.
export function CardSkeleton({ caption }) {
  return (
    <div role="status" className="max-w-2xl mx-auto space-y-4">
      <Skel className="h-64 w-full rounded-3xl" />
      <div className="flex gap-3">
        <Skel className="h-11 flex-1 rounded-xl" />
        <Skel className="h-11 flex-1 rounded-xl" />
      </div>
      {caption && <p className="text-center text-sm text-slate-500">{caption}</p>}
    </div>
  )
}

// A reading passage — title, measured lines, word chips.
export function PassageSkeleton() {
  return (
    <div role="status" className="rounded-3xl bg-[#151129] border border-white/5 p-5 space-y-3.5">
      <Skel className="h-5 w-40" />
      <Skel className="h-4 w-full" />
      <Skel className="h-4 w-[92%]" />
      <Skel className="h-4 w-[96%]" />
      <Skel className="h-4 w-[78%]" />
      <Skel className="h-4 w-[88%]" />
      <div className="flex gap-2 pt-1.5">
        <Skel className="h-7 w-20 rounded-full" />
        <Skel className="h-7 w-24 rounded-full" />
        <Skel className="h-7 w-16 rounded-full" />
      </div>
    </div>
  )
}
