import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Shopping List',
    short_name: 'Shoplist',
    description: 'Family shopping lists',
    start_url: '/lists',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    icons: [
      // PNG icons are required for Android WebAPK install (and therefore for
      // share-target registration). SVG remains as a scalable any-size option.
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    // share_target lets Android list this PWA in the system share sheet.
    // Single POST/multipart entry handles both text/URL and image shares.
    share_target: {
      action: '/share',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'image', accept: ['image/*'] }],
      },
    },
  } as MetadataRoute.Manifest
}
