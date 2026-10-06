-- Índices parciais (WHERE ... IS NOT NULL) não podem ser usados em ON CONFLICT (coluna),
-- o que fazia o webhook falhar com 42P10. Substituímos por índices únicos completos:
-- em Postgres, NULLs continuam distintos, então múltiplos NULL seguem permitidos.

DROP INDEX IF EXISTS public.assinaturas_provider_sub_uidx;
CREATE UNIQUE INDEX assinaturas_provider_sub_uidx
  ON public.assinaturas (provider_subscription_id);

DROP INDEX IF EXISTS public.assinatura_pagamentos_tx_uidx;
CREATE UNIQUE INDEX assinatura_pagamentos_tx_uidx
  ON public.assinatura_pagamentos (provider_transaction_id, status);