'use client'

interface Props {
  url: string
  onClose: () => void
}

export function Lightbox({ url, onClose }: Props) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
    >
      <img
        src={url}
        alt=""
        onClick={onClose}
        className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain cursor-pointer"
      />
    </div>
  )
}
