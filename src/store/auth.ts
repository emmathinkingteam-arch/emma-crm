import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User, UserRole } from '@/types'

interface AuthState {
  user: User | null
  role: UserRole | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      role: null,
      isLoading: true,
      setUser: (user) => set({ user, role: user?.role ?? null }),
      setLoading: (isLoading) => set({ isLoading }),
      clear: () => set({ user: null, role: null }),
    }),
    {
      name: 'emma-auth',
      partialize: (state) => ({ user: state.user, role: state.role }),
      onRehydrateStorage: () => (state) => {
        if (state) state.setLoading(false)
      },
    }
  )
)