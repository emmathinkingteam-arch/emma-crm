import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User, UserRole } from '@/types'

interface AuthState {
  user: User | null
  role: UserRole | null
  isLoading: boolean

  // ── Inspector mode ─────────────────────────────────────────
  // When an admin is inspecting a worker:
  //   • `user` and `role` are swapped to the worker's data so every
  //     dashboard page renders exactly as the worker sees it.
  //   • `adminBackup` holds the original admin user so we can restore it.
  //   • `inspecting` is the worker being previewed (non-null = in inspector mode).
  inspecting: User | null
  adminBackup: User | null

  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  clear: () => void

  // Start inspecting a worker — saves admin session, swaps to worker.
  startInspect: (worker: User) => void
  // Stop inspecting — restores the admin session.
  stopInspect: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      role: null,
      isLoading: true,
      inspecting: null,
      adminBackup: null,

      setUser: (user) => set({ user, role: user?.role ?? null }),
      setLoading: (isLoading) => set({ isLoading }),
      clear: () => set({ user: null, role: null, inspecting: null, adminBackup: null }),

      startInspect: (worker: User) => {
        const current = get().user
        set({
          adminBackup: current,
          inspecting: worker,
          user: worker,
          role: worker.role,
        })
      },

      stopInspect: () => {
        const backup = get().adminBackup
        set({
          user: backup,
          role: backup?.role ?? null,
          inspecting: null,
          adminBackup: null,
        })
      },
    }),
    {
      name: 'emma-auth',
      // Persist the inspector state too so a page refresh while inspecting
      // keeps the banner visible and the admin can still exit cleanly.
      partialize: (state) => ({
        user: state.user,
        role: state.role,
        inspecting: state.inspecting,
        adminBackup: state.adminBackup,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.setLoading(false)
      },
    }
  )
)