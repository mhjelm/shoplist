import sharp from 'sharp'

const src = 'public/icon-512.png'
const dst = 'public/icon-512-dark.png'
const W = 512, H = 512
const CH = 4

const { data, info } = await sharp(src)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

if (info.channels !== CH) throw new Error(`expected 4 channels, got ${info.channels}`)

const isWhiteish = (i) => {
  const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
  if (a < 30) return true
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  return max > 230 && max - min < 22
}

const visited = new Uint8Array(W * H)
const queue = []
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const p = y * W + x
  if (visited[p]) return
  const i = p * CH
  if (!isWhiteish(i)) return
  visited[p] = 1
  queue.push(p)
}

for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1) }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y) }

while (queue.length) {
  const p = queue.pop()
  const x = p % W, y = (p - x) / W
  push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
}

let recolored = 0
for (let p = 0; p < W * H; p++) {
  if (!visited[p]) continue
  const i = p * CH
  data[i] = 0
  data[i + 1] = 0
  data[i + 2] = 0
  data[i + 3] = 255
  recolored++
}

await sharp(data, { raw: { width: W, height: H, channels: CH } }).png().toFile(dst)
console.log(`wrote ${dst} — recolored ${recolored} / ${W * H} pixels (${(100 * recolored / (W * H)).toFixed(1)}%)`)
