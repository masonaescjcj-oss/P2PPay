import { useEffect, useRef } from 'react'

// Bottom sheet dialog built on <dialog> semantics (focus moves in, Escape closes).
export default function Sheet({ title, children, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const prev = document.activeElement
    ref.current?.querySelector('textarea, input, button')?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose])
  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 className="title">{title}</h2>
        {children}
      </div>
    </div>
  )
}
