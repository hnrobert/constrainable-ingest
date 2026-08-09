/** Event catalog item + create/update input (mirrors server services/events.ts). */
export type EventStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'archived'
export type ViewerAccess = 'public' | 'passphrase'

export interface EventView {
  id: number
  name: string
  slug: string
  description: string | null
  startsAt: number | null
  endsAt: number | null
  status: EventStatus
  limitsOverride: Record<string, number | null> | null
  recordEnabled: boolean
  viewerAccess: ViewerAccess
  hasViewerPassphrase: boolean
  createdAt: number
  updatedAt: number
}

export interface EventInput {
  name?: string
  slug?: string
  description?: string | null
  startsAt?: number | null
  endsAt?: number | null
  status?: EventStatus
  limitsOverride?: Record<string, number | null> | null
  recordEnabled?: boolean
  viewerAccess?: ViewerAccess
}
