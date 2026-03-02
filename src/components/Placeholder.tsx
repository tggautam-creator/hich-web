interface PlaceholderProps {
  name: string
  'data-testid'?: string
}

export default function Placeholder({ name, 'data-testid': testId }: PlaceholderProps) {
  return (
    <div style={{ padding: '2rem', fontFamily: 'DM Sans, sans-serif' }} data-testid={testId}>
      <h1>{name}</h1>
      <p>Coming soon.</p>
    </div>
  )
}
