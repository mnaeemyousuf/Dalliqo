import clsx from 'clsx';
import { BRAND } from '@recrm/shared';
import horizontalDark from '@/assets/brand/stateown-logo-horizontal-dark.svg';
import horizontalLight from '@/assets/brand/stateown-logo-horizontal.svg';
import mark from '@/assets/brand/stateown-mark.svg';
import primaryDark from '@/assets/brand/stateown-logo-primary-dark.svg';
import primaryLight from '@/assets/brand/stateown-logo-primary.svg';

type Variant = 'horizontal' | 'primary' | 'mark';

/**
 * The Stateown logo. Light/dark artwork switches with the theme (the `dark` class on <html>),
 * so the wordmark always has the right contrast. Generated from shared/brand/stateown.tokens.json.
 */
export function BrandLogo({ variant = 'horizontal', className }: { variant?: Variant; className?: string }) {
  const alt = `${BRAND.name} — ${BRAND.tagline}`;
  if (variant === 'mark') return <img src={mark} alt={BRAND.name} className={className} />;
  const [light, dark] = variant === 'primary' ? [primaryLight, primaryDark] : [horizontalLight, horizontalDark];
  return (
    <>
      <img src={light} alt={alt} className={clsx(className, 'dark:hidden')} />
      <img src={dark} alt={alt} className={clsx(className, 'hidden dark:block')} />
    </>
  );
}
