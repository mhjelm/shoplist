export async function resizeImage(file: Blob, maxEdge = 1024, quality = 0.85): Promise<Blob> {
  const fileInfo = `type=${file.type || 'unknown'}, size=${file.size}B`
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error(`Could not decode image (${fileInfo})`))
      i.src = url
    })
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error(`Image has no pixel data (${fileInfo})`)
    }

    const ratio = Math.min(maxEdge / img.naturalWidth, maxEdge / img.naturalHeight, 1)
    const w = Math.max(1, Math.round(img.naturalWidth * ratio))
    const h = Math.max(1, Math.round(img.naturalHeight * ratio))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(img, 0, 0, w, h)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Could not encode image'))),
        'image/jpeg',
        quality,
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
