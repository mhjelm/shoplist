import { log } from './log'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const ms = (since: number) => Math.round(performance.now() - since)

export async function resizeImage(file: Blob, maxEdge = 1024, quality = 0.85): Promise<Blob> {
  const fileInfo = `type=${file.type || 'unknown'}, size=${file.size}B`
  // One rich, timed event per attempt (no PII — type/size/timings/error only)
  // so a single real-device repro pinpoints WHERE and WHEN the Android
  // content:// read dies, instead of guessing. See docs/logging.md.
  const meta = { type: file.type || 'unknown', size: file.size }
  const t0 = performance.now()

  // Try the <img> + objectURL path FIRST. Chrome's image loader pipeline reads
  // the underlying content:// URI internally and handles Android permission
  // quirks better than Blob.arrayBuffer / FileReader, both of which can throw
  // NotReadableError on Android even for tiny local files. Only if <img> fails
  // do we fall back to materialising bytes in JS.
  let imgErr: unknown
  const tImg = performance.now()
  try {
    const blob = await resizeViaImageElement(file, maxEdge, quality)
    log.info('picture.resize_ok', { ...meta, via: 'img', total_ms: ms(t0), out: blob.size })
    return blob
  } catch (e) {
    imgErr = e
  }
  const imgMs = ms(tImg)

  let bytes: ArrayBuffer
  const tBytes = performance.now()
  try {
    bytes = await readBytesRobust(file)
  } catch (readErr) {
    log.warn('picture.resize_failed', {
      ...meta, stage: 'read',
      img_ms: imgMs, img_err: msg(imgErr),
      bytes_ms: ms(tBytes), bytes_err: msg(readErr),
      total_ms: ms(t0),
    })
    throw new Error(`Could not read image (${fileInfo}): img=${msg(imgErr)}; bytes=${msg(readErr)}`)
  }
  const bytesMs = ms(tBytes)

  const stable = new Blob([bytes], { type: file.type || 'image/jpeg' })
  try {
    const blob = await resizeViaImageBitmap(stable, fileInfo, maxEdge, quality)
    // Bytes read fine but <img> had failed — record so we know the img path is
    // the weak link (not the file itself).
    log.info('picture.resize_ok', { ...meta, via: 'bytes', img_ms: imgMs, img_err: msg(imgErr), bytes_ms: bytesMs, total_ms: ms(t0), out: blob.size })
    return blob
  } catch (decodeErr) {
    log.warn('picture.resize_failed', {
      ...meta, stage: 'decode',
      img_ms: imgMs, img_err: msg(imgErr),
      bytes_ms: bytesMs, decode_err: msg(decodeErr),
      total_ms: ms(t0),
    })
    throw decodeErr
  }
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
