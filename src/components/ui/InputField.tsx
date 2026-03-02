import { InputHTMLAttributes, useId } from 'react'

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  'data-testid'?: string
}

export default function InputField({
  label,
  error,
  hint,
  className = '',
  'data-testid': testId,
  id: idProp,
  ...rest
}: InputFieldProps) {
  const generatedId = useId()
  const id = idProp ?? generatedId

  return (
    <div className="flex w-full flex-col gap-1">
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-text-primary"
        >
          {label}
        </label>
      )}

      <input
        id={id}
        data-testid={testId}
        className={[
          'w-full rounded-xl border border-border bg-white px-4 py-3',
          'text-base text-text-primary placeholder:text-text-secondary',
          'transition-colors duration-150',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-primary',
          error
            ? 'border-danger focus:ring-danger'
            : 'border-border',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        ].join(' ')}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        aria-invalid={error ? true : undefined}
        {...rest}
      />

      {error && (
        <p id={`${id}-error`} className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-text-secondary">
          {hint}
        </p>
      )}
    </div>
  )
}
