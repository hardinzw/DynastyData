export function Loading({ label }: { label: string }) {
  return <p className="text-muted">{label}…</p>;
}

export function ErrorMessage({ error }: { error: unknown }) {
  return <p className="text-danger">{error instanceof Error ? error.message : String(error)}</p>;
}
