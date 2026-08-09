/**
 * Stream a recording's file with HTTP Range support for inline <video> playback.
 * Add ?download to force a download (Content-Disposition: attachment).
 */
import { createReadStream } from 'node:fs'
import { resolveRecordingFile } from '../../../services/recordings'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid id' })
  }
  const f = resolveRecordingFile(id)

  setHeader(event, 'content-type', f.mime)
  setHeader(event, 'accept-ranges', 'bytes')
  setHeader(event, 'cache-control', 'private, max-age=0')

  if (getQuery(event).download !== undefined) {
    setHeader(
      event,
      'content-disposition',
      `attachment; filename="${encodeURIComponent(f.filename)}"`,
    )
  }

  const range = getRequestHeader(event, 'range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m && m[1] ? Number.parseInt(m[1], 10) : 0
    const end = m && m[2] ? Number.parseInt(m[2], 10) : f.size - 1
    if (!Number.isFinite(start) || start > end || start >= f.size) {
      setResponseStatus(event, 416)
      setHeader(event, 'content-range', `bytes */${f.size}`)
      return null
    }
    setResponseStatus(event, 206)
    setHeader(event, 'content-range', `bytes ${start}-${end}/${f.size}`)
    setHeader(event, 'content-length', end - start + 1)
    return sendStream(event, createReadStream(f.absPath, { start, end }))
  }

  setHeader(event, 'content-length', f.size)
  return sendStream(event, createReadStream(f.absPath))
})
