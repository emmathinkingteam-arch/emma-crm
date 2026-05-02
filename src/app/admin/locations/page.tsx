'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MapPin } from 'lucide-react'
import { formatLastSeen } from '@/lib/utils'

export default function LocationsPage() {
  const [workers, setWorkers] = useState<any[]>([])
  useEffect(() => {
    supabase.from('users').select('id,full_name,role,last_lat,last_lng,last_seen').neq('role','admin').eq('is_active',true)
      .then(({data})=>{ if(data) setWorkers(data) })
  }, [])
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Worker Locations</h1>
      <p className="text-xs text-gray-400 font-medium mb-6">Captured when workers punch in/out on their profile</p>
      <div className="grid grid-cols-3 gap-5">
        {workers.map(w=>{
          const hasLoc = w.last_lat && w.last_lng
          return (
            <div key={w.id} className={`bg-white rounded-2xl border shadow-sm p-5 ${hasLoc?'border-gray-100':'border-gray-50 opacity-60'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 bg-pink-50 rounded-xl flex items-center justify-center text-pink-600 font-bold text-xs">{w.full_name?.[0]}</div>
                  <div><p className="text-xs font-bold text-gray-800">{w.full_name}</p><p className="text-[9px] text-pink-500 font-medium">{w.role.replace('_',' ')}</p></div>
                </div>
                <div className={`w-2.5 h-2.5 rounded-full ${hasLoc?'bg-green-400':'bg-gray-200'}`}/>
              </div>
              {hasLoc ? (
                <>
                  <a href={`https://www.google.com/maps?q=${w.last_lat},${w.last_lng}`} target="_blank"
                    className="block w-full h-28 bg-gray-100 rounded-xl mb-2 overflow-hidden hover:opacity-90 transition-opacity">
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-center"><MapPin size={24} className="text-pink-400 mx-auto mb-1"/><p className="text-[9px] text-gray-500 font-medium">{w.last_lat?.toFixed(4)}, {w.last_lng?.toFixed(4)}</p><p className="text-[8px] text-pink-500 font-bold mt-0.5">Open in Maps →</p></div>
                    </div>
                  </a>
                  <p className="text-[9px] text-gray-400 font-medium text-center">Last seen: {formatLastSeen(w.last_seen)}</p>
                </>
              ) : (
                <div className="w-full h-28 bg-gray-50 rounded-xl flex flex-col items-center justify-center gap-1">
                  <MapPin size={20} className="text-gray-200"/>
                  <p className="text-[9px] text-gray-300 font-bold uppercase tracking-wide">No location yet</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
