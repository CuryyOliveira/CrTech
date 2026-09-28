import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const url=process.env.SUPABASE_URL, svc=process.env.SUPABASE_SERVICE_ROLE_KEY, pub=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const opt=(k)=>({global:{fetch:(i,init)=>{const h=new Headers(init?.headers);if(k.startsWith('sb_')&&h.get('Authorization')===`Bearer ${k}`)h.delete('Authorization');h.set('apikey',k);return fetch(i,{...init,headers:h});}},auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(url,svc,opt(svc));
const st=JSON.parse(fs.readFileSync('/tmp/f12/state.json','utf8'));
const c1=createClient(url,pub,opt(pub));
await c1.auth.signInWithPassword({email:st.u1.email,password:st.u1.pass});
// 1) tentar alterar empresa existente (isolamento)
const { data: outra } = await c1.from('empresas').select('id,nome').neq('id', st.empId).limit(1).maybeSingle();
const upd = await c1.from('empresas').update({ observacoes:'INVASAO TESTE' }).eq('id', outra.id).select('id');
console.log('update empresa alheia:', JSON.stringify(upd.data), upd.error?.message ?? 'SEM ERRO');
// 2) tentar inserir vinculo em empresa alheia
const ins = await c1.from('empresa_usuarios').insert({ empresa_id: outra.id, user_id: st.u1.id, papel:'administrador', ativo:true }).select('id');
console.log('insert vinculo alheio:', JSON.stringify(ins.data), ins.error?.message ?? 'SEM ERRO');
// limpar se passou
if (ins.data?.[0]) await admin.from('empresa_usuarios').delete().eq('id', ins.data[0].id);
await admin.from('empresas').update({ observacoes: null }).eq('id', outra.id);
// 3) plano ESSENCIAL + assinatura trial 14 dias (sandbox) para a nova empresa
const { data: plano } = await admin.from('planos').select('id,codigo,max_usuarios,modulos,ambiente').eq('codigo','ESSENCIAL').eq('ambiente','sandbox').maybeSingle();
console.log('plano essencial:', plano);
const agora=new Date(), fim=new Date(agora.getTime()+14*864e5);
const { data: assin, error: eA } = await admin.from('assinaturas').insert({ empresa_id: st.empId, plano_id: plano.id, plano_codigo: plano.codigo, ambiente:'sandbox', status:'trial', provider:'mercadopago', provider_subscription_id:'test-'+Date.now(), periodicidade:'mensal', valor_centavos:7900, data_inicio:agora.toISOString(), periodo_atual_inicio:agora.toISOString(), periodo_atual_fim:fim.toISOString(), trial_inicio:agora.toISOString(), trial_fim:fim.toISOString(), contratada_por: st.u1.id }).select('id,status,trial_fim').maybeSingle();
console.log('assinatura trial:', assin, eA?.message);
const r = async (fn,a)=>{const {data,error}=await c1.rpc(fn,a); if(error)console.log('ERR',fn,error.message); return data;};
console.log('assinatura_ativa sandbox:', await r('assinatura_ativa_empresa',{_empresa_id:st.empId,_ambiente:'sandbox'}));
console.log('plano_da_empresa:', await r('plano_da_empresa',{_empresa_id:st.empId,_ambiente:'sandbox'}));
console.log('usuarios_ativos_empresa:', await r('usuarios_ativos_empresa',{_empresa_id:st.empId}));
fs.writeFileSync('/tmp/f12/state.json', JSON.stringify({...st, planoId:plano.id, assinaturaId:assin?.id, outraEmpresa:outra.id}));
