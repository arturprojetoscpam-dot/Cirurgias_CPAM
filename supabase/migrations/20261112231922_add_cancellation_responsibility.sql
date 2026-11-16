ALTER TABLE public.cirurgias
  ADD COLUMN IF NOT EXISTS responsabilidade_cancelamento text;

ALTER TABLE public.cirurgias
  DROP CONSTRAINT IF EXISTS cirurgias_responsabilidade_cancelamento_check;

ALTER TABLE public.cirurgias
  ADD CONSTRAINT cirurgias_responsabilidade_cancelamento_check
  CHECK (
    responsabilidade_cancelamento IS NULL
    OR responsabilidade_cancelamento IN ('PACIENTE', 'EXTRA-PACIENTE')
  );

COMMENT ON COLUMN public.cirurgias.responsabilidade_cancelamento IS
  'Classificação individual do cancelamento para relatórios: PACIENTE ou EXTRA-PACIENTE. Independente do motivo do catálogo.';

UPDATE public.cancelamentos
SET tipo = 'AMBOS', updated_at = now()
WHERE id_cancelamento = 16
  AND motivo = 'Outro';

-- Backfill only where the catalog provides an unambiguous classification.
-- Generic "Outro" and historical records without a catalog link remain unclassified.
UPDATE public.cirurgias c
SET responsabilidade_cancelamento = ca.tipo
FROM public.cancelamentos ca
WHERE c.id_cancelamento = ca.id_cancelamento
  AND ca.tipo IN ('PACIENTE', 'EXTRA-PACIENTE')
  AND c.responsabilidade_cancelamento IS NULL
  AND upper(coalesce(c."Situaçao", '')) = 'CANCELADA';
