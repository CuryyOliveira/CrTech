ALTER TABLE public.assinaturas ALTER COLUMN provider SET DEFAULT 'mercadopago';
ALTER TABLE public.assinatura_pagamentos ALTER COLUMN provider SET DEFAULT 'mercadopago';
ALTER TABLE public.webhook_eventos_pagamento ALTER COLUMN provider SET DEFAULT 'mercadopago';