/**
 * Gera os ícones do PWA sem dependência nenhuma: desenha num buffer RGBA e
 * escreve o PNG na mão (zlib do Node + os 3 chunks obrigatórios).
 * Rode `npm run icons` se quiser mudar a marca.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const BG = [25, 32, 48]
const ACCENT = [91, 140, 255]
const WHITE = [255, 255, 255]

/** Barras crescentes: [x, y, largura, altura] em fração do lado, e a cor. */
const BARS = [
  [0.26, 0.56, 0.11, 0.18, WHITE],
  [0.43, 0.44, 0.11, 0.3, WHITE],
  [0.6, 0.28, 0.11, 0.46, ACCENT],
]

function render(size, { padding = 0, radius = 0.22 } = {}) {
  const px = new Uint8Array(size * size * 4)
  const inset = Math.round(size * padding)
  const side = size - inset * 2
  const r = side * radius

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inside = inRounded(x - inset, y - inset, side, r)
      const color = inside ? BG : null
      px[i] = color?.[0] ?? 0
      px[i + 1] = color?.[1] ?? 0
      px[i + 2] = color?.[2] ?? 0
      px[i + 3] = inside ? 255 : 0
    }
  }

  for (const [bx, by, bw, bh, color] of BARS) {
    const x0 = inset + Math.round(bx * side)
    const y0 = inset + Math.round(by * side)
    const w = Math.round(bw * side)
    const h = Math.round(bh * side)
    const rr = w / 2
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (!inRounded(x - x0, y - y0, w, rr, h)) continue
        const i = (y * size + x) * 4
        px[i] = color[0]
        px[i + 1] = color[1]
        px[i + 2] = color[2]
        px[i + 3] = 255
      }
    }
  }

  return px
}

/** Ponto dentro de um retângulo de cantos arredondados. */
function inRounded(x, y, w, r, h = w) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false
  const cx = Math.min(Math.max(x, r), w - r)
  const cy = Math.min(Math.max(y, r), h - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function png(size, rgba) {
  // cada linha do PNG começa com o byte do filtro (0 = nenhum)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bits por canal
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

mkdirSync('public', { recursive: true })
const files = [
  ['public/icon-192.png', 192, {}],
  ['public/icon-512.png', 512, {}],
  // maskable: o sistema recorta as bordas, então o desenho fica no miolo
  ['public/icon-maskable.png', 512, { padding: 0.0, radius: 0.5 }],
  ['public/apple-touch-icon.png', 180, { radius: 0.0 }],
]
for (const [path, size, opts] of files) {
  writeFileSync(path, png(size, render(size, opts)))
  console.log(`✓ ${path} (${size}px)`)
}
