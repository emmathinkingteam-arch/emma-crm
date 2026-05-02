'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function SettingsPage() {
  const [counselors, setCounselors] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('users').select('id,full_name,meeting_link,work_start_time').eq('role','counselor').eq('is_active',true)
      .then(({data})=>{ if(data) setCounselors(data) })
  }, [])

  const updateCounselor = async (id:string, field:string, value:string) => {
    await supabase.from('users').update({ [field]: value }).eq('id', id)
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Settings</h1>

      {/* Agency settings */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
        <h2 className="text-sm font-bold text-gray-800 mb-4">Agency settings</h2>
        <div className="space-y-3">
          <div><label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Agency name</label>
            <input defaultValue="Emma Thinking (Pvt) Ltd" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none"/></div>
          <div><label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Country phone code</label>
            <input defaultValue="94 (Sri Lanka)" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none"/></div>
          <div><label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Default work start time</label>
            <input type="time" defaultValue="09:00" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none"/></div>
          <button className="bg-pink-600 text-white rounded-xl px-5 py-2.5 text-xs font-bold">Save settings</button>
        </div>
      </div>

      {/* Counselor Meet links */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-800 mb-1">Counselor Google Meet links</h2>
        <p className="text-xs text-gray-400 font-medium mb-4">Each counselor needs a Meet link. Used in all meeting confirmation messages.</p>
        <div className="space-y-3">
          {counselors.map(c=>(
            <div key={c.id}>
              <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{c.full_name}</label>
              <input defaultValue={c.meeting_link||''} onBlur={e=>updateCounselor(c.id,'meeting_link',e.target.value)}
                placeholder="meet.google.com/xxx-xxxx-xxx"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none"/>
            </div>
          ))}
          {counselors.length===0 && <p className="text-xs text-gray-300 font-medium">No counselors found. Add workers first.</p>}
        </div>
      </div>
    </div>
  )
}
