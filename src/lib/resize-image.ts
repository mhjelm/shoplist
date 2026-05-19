export async function resizeImage(file: Blob, maxEdge = 1024, quality = 0.85): Promise<Blob> {
  const fileInfo = `type=${file.type || 'unknown'}, size=${file.size}B`

  // Try the <img> + objectURL path FIRST. Chrome's image loader pipeline reads
  // the underlying content:// URI internally and handles Android permission
  // quirks better than Blob.arrayBuffer / FileReader, both of which can throw
  // NotReadableError on Android even for tiny local files. Only if <img> fails
  // do we fall back to materialising bytes in JS.
  let imgErr: unknown
  try {
    return await resizeViaImageElement(file, maxEdge, quality)
  } catch (e) {
    imgErr = e
  }

  let bytes: ArrayBuffer
  try {
    bytes = await readBytesRobust(file)
  } catch (readErr) {
    const m1 = imgErr instanceof Error ? imgErr.message : String(imgErr)
    const m2 = readErr instanceof Error ? readErr.message : String(readErr)
    throw new Error(`Could not read image (${fileInfo}): img=${m1}; bytes=${m2}`)
  }
  const stable = new Blob([bytes], { type: file.type || 'image/jpeg' })
  return await resizeViaImageBitmap(stable, fileInfo, maxEdge, quality)
}

async function resizeViaImageElement(file: Blob, maxEdge: number, quality: number): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('img.onerror'))
      el.src = url
    })
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error('Image has no pixel data')
    }
    return await drawToBlob(img, img.naturalWidth, img.naturalHeight, maxEdge, quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function resizeViaImageBitmap(blob: Blob, fileInfo: string, maxEdge: number, quality: number): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Could not decode image (${fileInfo}): ${msg}`)
  }
  try {
    if (!bitmap.width || !bitmap.height) {
      throw new Error(`Image has no pixel data (${fileInfo})`)
    }
    return await drawToBlob(bitmap, bitmap.width, bitmap.height, maxEdge, quality)
  } finally {
    bitmap.close()
  }
}

async function drawToBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
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
}

async function readBytesRobust(file: Blob): Promise<ArrayBuffer> {
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
      throw new Error(`arrayBuffer=${m1}; FileReader=${m2}`)
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
