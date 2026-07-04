// Shared bits for the internal team chat pages

export interface TeamMessage {
    id: string
    channel: 'group' | 'admin'
    thread_user_id: string | null
    sender_id: string
    sender_name: string
    sender_photo_url: string | null
    sender_role: string | null
    body: string
    created_at: string
}

// localStorage key holding the last-read timestamp (ms) for a channel
export function lastReadKey(channel: string): string {
    return `emma-chat-read-${channel}`
}

export function markChannelRead(channel: string) {
    localStorage.setItem(lastReadKey(channel), String(Date.now()))
}
