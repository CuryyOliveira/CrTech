-- Proprietário do sistema (nível 6) com acesso total.
--
-- As regras de integridade da Fase 0 (conferência encerrada imutável, itens de conferência
-- encerrada, lista com histórico, fotos) valiam para TODOS os usuários do app, inclusive o
-- proprietário: excluir uma conferência cancelada retornava "Somente um administrador pode
-- excluí-la". Agora o proprietário é tratado como operação privilegiada, igual ao servidor:
-- pode alterar, reabrir e excluir — e toda alteração em conferência encerrada continua
-- registrada na auditoria (app_private.auditar_conferencia).
--
-- As policies de RLS já dão acesso global ao proprietário (eh_global = nível ≥ 5).

SET search_path = public, extensions;

-- O usuário é o proprietário do sistema (nível 6, não bloqueado)?
CREATE OR REPLACE FUNCTION app_private.eh_proprietario(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT _user_id IS NOT NULL AND app_private.nivel(_user_id) >= 6
$$;
REVOKE ALL ON FUNCTION app_private.eh_proprietario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.eh_proprietario(uuid) TO authenticated, service_role;

-- SECURITY INVOKER de propósito: precisa enxergar quem chama em current_user.
CREATE OR REPLACE FUNCTION app_private.alteracao_privilegiada()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'app_private'
AS $$
  SELECT current_user NOT IN ('authenticated', 'anon')
      OR app_private.eh_proprietario(auth.uid())
$$;

-- A auditoria é chamada pelos triggers de integridade no contexto de quem altera; agora isso
-- inclui o proprietário (papel authenticated). app_private não é exposto pela API.
GRANT EXECUTE ON FUNCTION app_private.auditar_conferencia(text, text, public.conferencias) TO authenticated;
