export function slColorFor(id: string): 0 | 1 | 2 | 3 {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 4) as 0 | 1 | 2 | 3
}

export function slFlareDelay(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 17 + id.charCodeAt(i)) | 0
  const tenths = Math.abs(h) % 90
  return `${(tenths / 10).toFixed(1)}s`
}
