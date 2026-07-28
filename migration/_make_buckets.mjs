import { createClient } from '@supabase/supabase-js';
const neu = createClient(process.env.NEW_SUPABASE_URL, process.env.NEW_SERVICE_ROLE_KEY, { auth:{persistSession:false}});
// Replicate OLD bucket config (same public flags so app keeps working as drop-in)
const buckets = [
  { id:'attendance-records', public:false },
  { id:'avatars',            public:true  },
  { id:'esign',              public:true  },
  { id:'invoices',           public:true  },
  { id:'Invoices',           public:true  },
  { id:'whatsapp-broadcasts',public:true  },
];
for (const b of buckets){
  const { error } = await neu.storage.createBucket(b.id, { public:b.public });
  console.log((error && !/already exists/i.test(error.message)) ? `✗ ${b.id}: ${error.message}` : `✓ ${b.id} (${b.public?'public':'private'})`);
}
const { data } = await neu.storage.listBuckets();
console.log('NEW buckets now:', data.map(x=>x.id+(x.public?'(pub)':'(priv)')).join(', '));
