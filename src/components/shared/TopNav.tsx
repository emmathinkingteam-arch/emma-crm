'use client'

import { useEffect, useState } from 'react'
import { Bell, X, CheckCircle2, Clock, AlertTriangle, ChevronRight, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Task } from '@/types'
import { getDaysLeft, getProgressPercent } from '@/lib/utils'

export default function TopNav() {
  const { user } = useAuthStore()
  const [tasks, setTasks] = useState<Task[]>([])
  const [notifOpen, setNotifOpen] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', user.id)
      .order('deadline', { ascending: true })
      .then(({ data }) => { if (data) setTasks(data as Task[]) })
  }, [user])

  const activeTasks = tasks.filter((t) => t.status !== 'done')

  return (
    <>
      <div className="bg-pink-100 px-4 py-3 flex items-center justify-between rounded-b-[28px] sticky top-0 z-40">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shadow-sm">
            <span className="text-pink-600 font-bold text-xs">E</span>
          </div>
          <span className="text-pink-600 font-bold text-sm tracking-tight">Emma Thinking</span>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2.5">
          {/* Wallet pill */}
          <div className="bg-white/70 border border-pink-200 rounded-full px-2.5 py-1 flex items-center gap-1.5">
            <Wallet size={11} className="text-pink-600" />
            <span className="text-xs font-semibold text-gray-700">
              LKR {(user?.wallet_balance ?? 0).toLocaleString()}
            </span>
          </div>

          {/* Bell */}
          <button onClick={() => setNotifOpen(true)} className="relative">
            <Bell size={20} className="text-gray-600" />
            {activeTasks.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-pink-600 rounded-full text-white text-[7px] font-bold flex items-center justify-center">
                {activeTasks.length}
              </span>
            )}
          </button>

          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-pink-600 flex items-center justify-center text-white text-xs font-bold border-2 border-white shadow-sm">
            {user?.full_name?.[0] ?? 'U'}
          </div>
        </div>
      </div>

      {/* Task notification panel */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm px-4 pb-6"
          onClick={() => setNotifOpen(false)}
        >
          <div
            className="bg-white w-full max-w-md rounded-[28px] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-50">
              <div>
                <h2 className="text-sm font-bold text-gray-800">My Tasks</h2>
                <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mt-0.5">
                  {activeTasks.length} active
                </p>
              </div>
              <button
                onClick={() => setNotifOpen(false)}
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"
              >
                <X size={13} />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[65vh] px-4 py-4 space-y-3">
              {tasks.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 size={28} className="text-green-300 mx-auto mb-2" />
                  <p className="text-xs font-bold text-gray-400">All done!</p>
                </div>
              ) : (
                tasks.map((task) => {
                  const daysLeft = getDaysLeft(task.deadline)
                  const progress = getProgressPercent(task.created_at, task.deadline)
                  const isDone = task.status === 'done'
                  const isOverdue = daysLeft < 0 && !isDone
                  const isUrgent = daysLeft <= 2 && !isDone
                  const barColor = isOverdue ? '#EF4444' : isUrgent ? '#F97316' : '#EA1E63'

                  return (
                    <div
                      key={task.id}
                      className={`bg-white border rounded-[20px] p-4 ${isUrgent || isOverdue ? 'border-red-100' : 'border-gray-100'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isDone ? 'bg-green-50' : isUrgent || isOverdue ? 'bg-red-50' : 'bg-pink-50'}`}>
                            {isDone ? <CheckCircle2 size={16} className="text-green-500" />
                              : isUrgent || isOverdue ? <AlertTriangle size={16} className="text-red-400" />
                              : <Clock size={16} className="text-pink-600" />}
                          </div>
                          <p className="text-xs font-bold text-gray-800 leading-tight">{task.title}</p>
                        </div>
                        <span className={`text-[8px] font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0 ${isDone ? 'bg-green-50 text-green-600' : isOverdue ? 'bg-red-50 text-red-500' : isUrgent ? 'bg-orange-50 text-orange-500' : 'bg-pink-50 text-pink-600'}`}>
                          {isDone ? 'Done' : isOverdue ? `${Math.abs(daysLeft)}d late` : daysLeft === 0 ? 'Today!' : `${daysLeft}d`}
                        </span>
                      </div>
                      {!isDone && (
                        <div className="mt-3">
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${progress}%`, background: barColor }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
