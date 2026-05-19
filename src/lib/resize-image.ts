export async function resizeImage(file: Blob, maxEdge = 1024, quality = 0.85): Promise<Blob> {
  const fileInfo = `type=${file.type || 'unknown'}, size=${file.size}B`

  // Materialise the bytes before decoding. The Android photo picker hands JS a
  // content://-backed Blob whose underlying file descriptor permission can be
  // revoked between picker and read ("NotReadableError"), and the descriptor
  // can also be partially read or consumed by the decoder. Copying into an
  // in-memory Blob removes both classes of flake.
  const buf = await readBytesRobust(file, fileInfo)
  const stable = new Blob([buf], { type: file.type || 'image/jpeg' })

  const source = await decodeWithFallback(stable, fileInfo)
  try {
    const width = 'naturalWidth' in source ? source.naturalWidth : source.width
    const height = 'naturalHeight' in source ? source.naturalHeight : source.height
    if (!width || !height) {
      throw new Error(`Image has no pixel data (${fileInfo})`)
    }
    const ratio = Math.min(maxEdge / width, maxEdge / height, 1)
    const w = Math.max(1, Math.round(width * ratio))
    const h = Math.max(1, Math.round(height * ratio))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(source, 0, 0, w, h)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Could not encode image'))),
        'image/jpeg',
        quality,
      )
    })
  } finally {
    if ('close' in source) source.close()
    else if (source.dataset.objectUrl) URL.revokeObjectURL(source.dataset.objectUrl)
  }
}

async function decodeWithFallback(blob: Blob, fileInfo: string): Promise<ImageBitmap | HTMLImageElement> {
  let bitmapErr: unknown
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch (e) {
    bitmapErr = e
  }
  try {
    return await loadImageElement(blob)
  } catch {
    await new Promise(r => setTimeout(r, 150))
    try {
      return await loadImageElement(blob)
    } catch (imgErr2) {
      const b = bitmapErr instanceof Error ? bitmapErr.message : String(bitmapErr)
      const i = imgErr2 instanceof Error ? imgErr2.message : String(imgErr2)
      throw new Error(`Could not decode image (${fileInfo}): bitmap=${b}; img=${i}`)
    }
  }
}

async function readBytesRobust(file: Blob, fileInfo: string): Promise<ArrayBuffer> {
  let firstErr: unknown
  try {
    return await file.arrayBuffer()
  } catch (e) {
    firstErr = e
  }
  try {
    return await readWithFileReader(file)
  } catch {
    await new Promise(r => setTimeout(r, 150))
    try {
      return await readWithFileReader(file)
    } catch (e2) {
      const m1 = firstErr instanceof Error ? firstErr.message : String(firstErr)
      const m2 = e2 instanceof Error ? e2.message : String(e2)
      throw new Error(`Could not read image (${fileInfo}): arrayBuffer=${m1}; FileReader=${m2}`)
    }
  }
}

function readWithFileReader(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result
      if (r instanceof ArrayBuffer) resolve(r)
      else reject(new Error('FileReader returned non-ArrayBuffer'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsArrayBuffer(file)
  })
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.dataset.objectUrl = url
    img.onload = () => resolve(img)
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('img.onerror'))
    }
    img.src = url
  })
}
