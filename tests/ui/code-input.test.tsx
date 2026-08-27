// tests/ui/code-input.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodeInput } from '@/components/ui/code-input'

describe('CodeInput', () => {
  it('renders one box per digit', () => {
    render(<CodeInput label="Verification code" value="" onChange={() => {}} />)
    expect(screen.getAllByRole('textbox')).toHaveLength(6)
  })

  it('reports the full value as digits are typed', () => {
    const onChange = vi.fn()
    render(<CodeInput label="Verification code" value="49" onChange={onChange} />)
    fireEvent.change(screen.getAllByRole('textbox')[2], { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith('492')
  })

  it('accepts a pasted code', () => {
    const onChange = vi.fn()
    render(<CodeInput label="Verification code" value="" onChange={onChange} />)
    fireEvent.paste(screen.getAllByRole('textbox')[0], {
      clipboardData: { getData: () => '492817' },
    })
    expect(onChange).toHaveBeenCalledWith('492817')
  })

  it('ignores non-digits', () => {
    const onChange = vi.fn()
    render(<CodeInput label="Verification code" value="" onChange={onChange} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'a' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
