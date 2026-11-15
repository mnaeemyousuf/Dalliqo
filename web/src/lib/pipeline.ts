import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DEAL_STAGES, OPEN_DEAL_STAGES, PERMISSIONS, activeOpenStages, isDealStageEnabled, normalizeDealPipeline, type DealStage } from '@recrm/shared';
import { dealApi } from '@/api/endpoints';
import { useCan } from '@/store/auth';

/** The business's deal pipeline: which stages it uses and what it calls them. */
export function useDealPipeline() {
  const { t, i18n } = useTranslation();
  const canRead = useCan(PERMISSIONS.DEALS_READ);
  const q = useQuery({ queryKey: ['deal-pipeline'], queryFn: dealApi.pipeline, staleTime: 5 * 60_000, enabled: canRead });
  const pipeline = q.data ? normalizeDealPipeline(q.data) : null;
  const urdu = i18n.language.startsWith('ur');
  const label = (stage: DealStage) => {
    const c = pipeline?.stages.find((s) => s.stage === stage);
    return (urdu ? c?.labelUr : c?.label) || t(`enums.dealStage.${stage}`);
  };
  return {
    pipeline,
    label,
    openStages: pipeline ? activeOpenStages(pipeline) : [...OPEN_DEAL_STAGES],
    stages: pipeline ? DEAL_STAGES.filter((s) => isDealStageEnabled(pipeline, s)) : [...DEAL_STAGES],
  };
}
