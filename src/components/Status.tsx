export function Loading({ label }: { label: string }) {
  return <p className="text-slate-400">{label}…</p>;
}

export function ErrorMessage({ error }: { error: unknown }) {
  return <p className="text-red-400">{error instanceof Error ? error.message : String(error)}</p>;
}
