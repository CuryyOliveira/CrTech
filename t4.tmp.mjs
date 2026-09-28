import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const url=process.env.SUPABASE_URL, svc=process.env.SUPABASE_SERVICE_ROLE_KEY;
const opt=(k)=>({global:{fetch:(i,init)=>{const h=new Headers(init?.headers);if(k.startsWith('sb_')&&h.get('Authorization')===`Bearer ${k}`)h.delete('Authorization');h.set('apikey',k);return fetch(i,{...init,headers:h});}},auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(url,svc,opt(svc));
const st=JSON.parse(fs.readFileSync('/tmp/f12/state.json','utf8'));
const ids=[];
for(const n of [2,3]){
  const email=`f12.u${n}.${Date.now()}@teste.local`;
  const r=await admin.auth.admin.createUser({email,password:'Teste@123456',email_confirm:true});
  console.log('createUser', email, r.error?.message ?? r.data.user.id);
  if(r.error) continue; ids.push(r.data.user.id);
  const l=await admin.from('empresa_usuarios').insert({empresa_id:st.empId,user_id:r.data.user.id,papel:'usuario',ativo:true}).select('id');
  console.log('link', JSON.stringify(l.data), l.error?.message);
}
console.log('ativos:', (await admin.rpc('usuarios_ativos_empresa',{_empresa_id:st.empId})).data);
fs.writeFileSync('/tmp/f12/state.json', JSON.stringify({...st, extras: ids}));
