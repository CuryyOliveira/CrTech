-- Usuário legado sem empresa (ex.: conta "aprendiz") não conseguia criar listas, por exemplo a
-- lista reservada da "Conferência única": o preenchimento automático de empresa_id usava apenas
-- empresa_do_usuario(), que é NULL para quem não tem vínculo em empresa_usuarios. A linha ficava
-- sem empresa e a RLS de INSERT (acesso_unidade) exige nível global para empresa_id NULL →
-- "new row violates row-level security policy for table unidades".
--
-- Correção: quando o usuário não tem empresa e é legado, usa a empresa legada — a mesma que a RLS
-- já lhe permite ler e alterar (acesso_unidade → empresa_legada). Só quando ela é única; se houver
-- mais de uma, nada muda (a RLS continua recusando, sem adivinhar a empresa).

CREATE OR REPLACE FUNCTION app_private.empresa_para_insercao(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT COALESCE(
    public.empresa_do_usuario(_user_id),
    CASE
      WHEN app_private.eh_legado(_user_id) AND NOT app_private.tem_empresa(_user_id) THEN (
        SELECT min(eu.empresa_id::text)::uuid
          FROM public.empresa_usuarios eu
          JOIN public.usuarios_legados l ON l.user_id = eu.user_id
         WHERE eu.ativo = true
        HAVING count(DISTINCT eu.empresa_id) = 1
      )
    END
  )
$$;

REVOKE ALL ON FUNCTION app_private.empresa_para_insercao(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.unidades_escopo_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := app_private.empresa_para_insercao(auth.uid());
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.preencher_escopo_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
BEGIN
  IF NEW.empresa_id IS NULL AND NEW.unidade_id IS NOT NULL THEN
    SELECT u.empresa_id, COALESCE(NEW.modulo_id, u.modulo_id)
      INTO NEW.empresa_id, NEW.modulo_id
      FROM public.unidades u WHERE u.id = NEW.unidade_id;
  END IF;
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := app_private.empresa_para_insercao(auth.uid());
  END IF;
  RETURN NEW;
END
$$;
