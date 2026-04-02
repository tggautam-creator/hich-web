interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  'data-testid'?: string
}

const SIZE_MAP = { sm: 32, md: 48, lg: 80 } as const

export default function Logo({ size = 'md', 'data-testid': testId = 'logo' }: LogoProps) {
  const px = SIZE_MAP[size]
  const showText = size === 'lg'

  return (
    <div data-testid={testId} className="flex items-center gap-3" style={{ height: px }}>
      <img
        src="/logo-transparent.png"
        alt="TAGO"
        width={px}
        height={px}
        aria-hidden="true"
      />
      {showText && (
        <span className="text-3xl font-extrabold tracking-tight text-primary">
          TAGO
        </span>
      )}
    </div>
  )
}
