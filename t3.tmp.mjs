import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const url=process.env.SUPABASE_URL, svc=process.env.SUPABASE_SERVICE_ROLE_KEY, pub=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const opt=(k)=>({global:{fetch:(i,init)=>{const h=new Headers(init?.headers);if(k.startsWith('sb_')&&h.get('Authorization')===`Bearer ${k}`)h.delete('Authorization');h.set('apikey',k);return fetch(i,{...init,headers:h});}},auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(url,svc,opt(svc));
const st=JSON.parse(fs.readFileSync('/tmp/f12/state.json','utf8'));
const c1=createClient(url,pub,opt(pub));
await c1.auth.signInWithPassword({email:st.u1.email,password:st.u1.pass});
const { data: vis } = await c1.from('empresas').select('id,nome');
console.log('A) empresas visiveis:', vis);
const { data: outra } = await admin.from('empresas').select('id,nome,observacoes').neq('id', st.empId).limit(1).maybeSingle();
const upd = await c1.from('empresas').update({observacoes:'INVASAO'}).eq('id',outra.id).select('id');
console.log('B) update empresa alheia:', JSON.stringify(upd.data), upd.error?.message ?? '(sem erro)');
const ins = await c1.from('empresa_usuarios').insert({empresa_id:outra.id,user_id:st.u1.id,papel:'administrador',ativo:true}).select('id');
console.log('C) insert vinculo alheio:', JSON.stringify(ins.data), ins.error?.message ?? '(sem erro)');
const insOwn = await c1.from('empresa_usuarios').insert({empresa_id:st.empId,user_id:st.u1.id,papel:'usuario',ativo:true}).select('id');
console.log('D) insert vinculo na propria empresa (burlar limite):', JSON.stringify(insOwn.data), insOwn.error?.message ?? '(sem erro)');
if (ins.data?.[0]) await admin.from('empresa_usuarios').delete().eq('id',ins.data[0].id);
if (insOwn.data?.[0]) await admin.from('empresa_usuarios').delete().eq('id',insOwn.data[0].id);
await admin.from('empresas').update({observacoes:outra.observacoes}).eq('id',outra.id);
// trial 14 dias no plano essencial
const { data: plano } = await admin.from('planos').select('id,codigo,max_usuarios,modulos').eq('codigo','essencial_mensal').eq('ambiente','sandbox').maybeSingle();
const agora=new Date(), fim=new Date(agora.getTime()+14*864e5);
let assin = (await admin.from('assinaturas').select('id').eq('empresa_id',st.empId).maybeSingle()).data;
if(!assin){ const r = await admin.from('assinaturas').insert({empresa_id:st.empId,plano_id:plano.id,plano_codigo:plano.codigo,ambiente:'sandbox',status:'trial',provider:'mercadopago',provider_subscription_id:'f12-'+Date.now(),periodicidade:'mensal',valor_centavos:7900,data_inicio:agora.toISOString(),periodo_atual_inicio:agora.toISOString(),periodo_atual_fim:fim.toISOString(),trial_inicio:agora.toISOString(),trial_fim:fim.toISOString(),contratada_por:st.u1.id}).select('id,status,trial_fim').maybeSingle(); console.log('assin err', r.error?.message); assin=r.data; }
console.log('E) assinatura trial:', assin);
const r=async(fn,a)=>{const{data,error}=await c1.rpc(fn,a); if(error)console.log('ERR',fn,error.message); return data;};
console.log('F) ativa:', await r('assinatura_ativa_empresa',{_empresa_id:st.empId,_ambiente:'sandbox'}));
const p = await r('plano_da_empresa',{_empresa_id:st.empId,_ambiente:'sandbox'});
console.log('G) plano:', JSON.stringify(p));
const dias = p?.trial_fim ? Math.round((new Date(p.trial_fim)-agora)/864e5) : null; console.log('H) dias trial:', dias);
// seats: adiciona 2 usuarios via service role (como o backend faz)
const extras=[];
for (const n of [2,3]) {
  const email=`f12.u${n}.${Date.now()}@teste.local`;
  const { data:u,error } = await admin.auth.admin.createUser({email,password:'Teste@123456',email_confirm:true});
  if(error){console.log('erro criar',error.message);continue;}
  extras.push(u.user.id);
  await admin.from('empresa_usuarios').insert({empresa_id:st.empId,user_id:u.user.id,papel:'usuario',ativo:true});
  await admin.from('user_profiles').update({perfil:'agricola',bloqueado:false}).eq('user_id',u.user.id);
}
console.log('I) usuarios ativos da empresa nova:', await r('usuarios_ativos_empresa',{_empresa_id:st.empId}), 'limite', p?.max_usuarios);
console.log('J) usuarios ativos empresa legada (contagem por empresa):', (await admin.rpc('usuarios_ativos_empresa',{_empresa_id:outra.id})).data);
fs.writeFileSync('/tmp/f12/state.json', JSON.stringify({...st, extras, outraEmpresa:outra.id, assinaturaId:assin?.id}));
