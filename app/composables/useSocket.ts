/**
 * Singleton Socket.IO client. The server attaches socket.io to the SAME origin
 * as the app (lazy on first request, same port 3000), so we connect same-origin
 * with no explicit host/port.
 *
 * Client-only: call from onMounted / a .client plugin (no window on SSR).
 */
import { io, type Socket } from 'socket.io-client'

let _socket: Socket | null = null

export function useSocket(): Socket {
  if (_socket) return _socket
  _socket = io({
    path: '/socket',
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
  })
  return _socket
}

export function disposeSocket(): void {
  if (_socket) {
    _socket.disconnect()
    _socket = null
  }
}
