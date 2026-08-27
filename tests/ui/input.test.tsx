// tests/ui/input.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Input } from '@/components/ui/input'

describe('Input', () => {
  it('associates the label with the control', () => {
    render(<Input label="Email" name="email" />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('announces an error and marks the field invalid', () => {
    render(<Input label="Email" name="email" error="Enter a valid email address" />)
    const field = screen.getByLabelText('Email')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address')
  })
})
