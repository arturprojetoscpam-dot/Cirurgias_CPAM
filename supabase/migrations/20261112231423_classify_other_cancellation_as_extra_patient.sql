-- The generic "Outro" option describes cancellations unrelated to the patient.
-- Keep it out of the AMBOS group so it is only offered under EXTRA-PACIENTE.
UPDATE public.cancelamentos
SET tipo = 'EXTRA-PACIENTE', updated_at = now()
WHERE id_cancelamento = 16
  AND motivo = 'Outro';
