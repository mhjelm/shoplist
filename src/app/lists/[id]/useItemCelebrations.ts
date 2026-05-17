import { useRef, useState } from 'react'
import type { Item } from '@/lib/types'

export interface GhostItem {
  key: string
  name: string
  picture_url: string | null
  measurement: string | null
  rect: DOMRect
  itemTextClass: string
  thumbSizeClass: string
}

let ghostSeq = 0

export function useItemCelebrations({
  itemTextClass,
  thumbSizeClass,
}: {
  itemTextClass: string
  thumbSizeClass: string
}) {
  const [ghosts, setGhosts] = useState<GhostItem[]>([])
  const fwCanvasRef = useRef<{ explode: (x: number, y: number) => void } | null>(null)

  function spawnGhost(item: Item, rect: DOMRect) {
    const ghost: GhostItem = {
      key: `ghost-${ghostSeq++}`,
      name: item.name,
      picture_url: item.picture_url,
      measurement: item.measurement,
      rect,
      itemTextClass,
      thumbSizeClass,
    }
    setGhosts(g => [...g, ghost])
  }

  return { ghosts, setGhosts, fwCanvasRef, spawnGhost }
}
