import { href } from '../website/router';
import { useI18n } from '../i18n';
import { LinkButton } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { EmptyArt } from '../figures/EmptyArt';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="page page--narrow">
      <div className="card">
        <EmptyState
          art={<EmptyArt kind="lost" />}
          title={t('errors.notFoundTitle')}
          text={t('errors.notFoundText')}
          action={
            <LinkButton variant="primary" href={href({ name: 'overview' })}>
              {t('errors.home')}
            </LinkButton>
          }
        />
      </div>
    </div>
  );
}
