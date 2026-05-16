export async function resizeImage(file: Blob, maxEdge = 1024, quality = 0.85): Promise<Blob> {
  const fileInfo = `type=${file.type || 'unknown'}, size=${file.size}B`
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Could not decode image (${fileInfo}): ${msg}`)
  }
  try {
    if (!bitmap.width || !bitmap.height) {
      throw new Error(`Image has no pixel data (${fileInfo})`)
    }
    const ratio = Math.min(maxEdge / bitmap.width, maxEdge / bitmap.height, 1)
    const w = Math.max(1, Math.round(bitmap.width * ratio))
    const h = Math.max(1, Math.round(bitmap.height * ratio))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Could not encode image'))),
        'image/jpeg',
        quality,
      )
    })
  } finally {
    bitmap.close()
  }
}
