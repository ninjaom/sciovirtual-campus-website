/** Empty page shell used until a screen is built. */
export function Placeholder({ title }: { title: string }) {
  return (
    <main className="page">
      <h1 style={{ color: 'var(--blue)' }}>{title}</h1>
    </main>
  )
}

export function AdminPlaceholder({ title }: { title: string }) {
  return <h1 style={{ color: 'var(--blue)' }}>{title}</h1>
}
