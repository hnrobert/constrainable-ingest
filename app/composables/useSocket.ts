/**
 * Singleton Socket.IO client. The server always runs standalone on SOCKET_PORT
 * (dev and prod alike), so the client always connects there explicitly.
 *
 * Client-only: call from onMounted / a .client plugin (no window on SSR).
 */
import { io, type Socket } from 'socket.io-client'

let _socket: Socket | null = null

function resolveUrl(): string {
  const cfg = useRuntimeConfig()
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return `http://${host}:${cfg.public.socketPort}`
}

export function useSocket(): Socket {
  if (_socket) return _socket
  _socket = io(resolveUrl(), {
    path: '/socket.io',
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
