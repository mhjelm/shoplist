import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Lightbox } from '@/app/lists/[id]/Lightbox'

describe('Lightbox', () => {
  it('renders an img with the given url', () => {
    const { container } = render(<Lightbox url="https://example.com/photo.jpg" onClose={vi.fn()} />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/photo.jpg')
  })

  it('calls onClose when the image is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(<Lightbox url="https://example.com/photo.jpg" onClose={onClose} />)
    fireEvent.click(container.querySelector('img')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(<Lightbox url="https://example.com/photo.jpg" onClose={onClose} />)
    fireEvent.click(container.firstElementChild!)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
