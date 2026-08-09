/**
 * Socket.IO server — always standalone on SOCKET_PORT.
 *
 * We previously tried attaching to the app's HTTP server via the Nitro `listen`
 * hook in production, but that hook is not emitted by the node-server preset
 * (verified: the attach silently never happens). Running standalone on a fixed
 * port in BOTH dev and prod is reliable and identical across environments; the
 * client always connects to `http://<host>:SOCKET_PORT`. For a single-machine
 * intranet deploy an extra published port is no concern.
 *
 * The in-process bus is bridged to all connected admin clients.
 */
import { Server as SocketIOServer } from 'socket.io'
import { onBus } from '../utils/bus'
import { env } from '../utils/env'
import type { BusEventMap, BusEventName } from '#shared/events'

/** bus events forwarded verbatim to admin clients */
const FORWARD: BusEventName[] = [
  'session:start',
  'session:metric',
  'session:violation',
  'session:stop',
  'recording:ready',
  'audit:created',
  'config:changed',
]

function wire(io: SocketIOServer): void {
  for (const name of FORWARD) {
    onBus(name, (payload: BusEventMap[typeof name]) => io.emit(name, payload))
  }
  io.on('connection', (s) => {
    console.log(`[socket.io] client connected (${s.id})`)
    s.on('disconnect', (reason) => console.log(`[socket.io] disconnected: ${reason}`))
  })
}

export default defineNitroPlugin(() => {
  const io = new SocketIOServer(env.socketPort, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    cors: { origin: '*' },
  })
  wire(io)
  console.log(`[socket.io] standalone on :${env.socketPort}`)
})
