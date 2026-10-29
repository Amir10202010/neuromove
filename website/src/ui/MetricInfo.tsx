import { useI18n } from '../i18n';
import { InfoPopover } from './InfoPopover';

export type MetricInfoKey = 'rom' | 'symmetry' | 'sparc' | 'trunk' | 'cv' | 'quality';

/** «?» с формулой метрики — из словаря, на языке интерфейса. */
export function MetricInfo({ metric }: { metric: MetricInfoKey }) {
  const { t } = useI18n();
  return (
    <InfoPopover title={t(`metric.info.${metric}.title`)} formula={t(`metric.info.${metric}.formula`)} label={`${t('common.howComputed')}: ${t(`metric.info.${metric}.title`)}`}>
      {t(`metric.info.${metric}.text`)}
    </InfoPopover>
  );
}
