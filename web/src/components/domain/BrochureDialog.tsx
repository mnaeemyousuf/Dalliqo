import { Copy, Download, FileText, Image as ImageIcon, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { brochureApi } from '@/api/endpoints';
import type { Property } from '@/api/types';
import { Button, Checkbox, Modal, Select } from '@/components/ui';
import { useErrorText, useMembers } from '@/lib/hooks';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toast';

/**
 * Brochure for sharing a listing: A4 PDF or a 1080×1350 image with the agent's WhatsApp QR, in English or
 * Urdu. Only the asking price is ever printed (never the minimum or expected price), and it can be hidden.
 */
export function BrochureDialog({ property, onClose }: { property: Property; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const me = useAuth((s) => s.user?._id) ?? '';
  const members = useMembers();
  const [lang, setLang] = useState<'en' | 'ur'>(i18n.language === 'ur' ? 'ur' : 'en');
  const [hidePrice, setHidePrice] = useState(false);
  const [agentId, setAgentId] = useState(me);
  const [busy, setBusy] = useState<string | null>(null);
  const opts = { lang, hidePrice, agentId: agentId && agentId !== me ? agentId : undefined };
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open onClose={onClose} title={t('brochure.title')}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('brochure.hint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('agreement.language')} options={[{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو' }]} value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'ur')} />
          {members.options.length > 0 && <Select label={t('brochure.agent')} options={members.options} value={agentId} onChange={(e) => setAgentId(e.target.value)} />}
        </div>
        <Checkbox label={t('brochure.hidePrice')} checked={hidePrice} onChange={setHidePrice} />
        <p className="text-xs text-muted">{t('brochure.confidential')}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button icon={<FileText className="h-4 w-4" />} loading={busy === 'pdf'} onClick={() => void run('pdf', () => brochureApi.download(property._id, { ...opts, format: 'pdf' }))}>{t('brochure.pdf')}</Button>
          <Button variant="secondary" icon={<ImageIcon className="h-4 w-4" />} loading={busy === 'png'} onClick={() => void run('png', () => brochureApi.download(property._id, { ...opts, format: 'png' }))}>{t('brochure.image')}</Button>
          <Button
            variant="secondary"
            icon={<Copy className="h-4 w-4" />}
            loading={busy === 'copy'}
            onClick={() => void run('copy', async () => {
              const r = await brochureApi.text(property._id, opts);
              await navigator.clipboard.writeText(r.text);
              toast.success(t('brochure.copied'));
            })}
          >
            {t('brochure.copyText')}
          </Button>
          <Button
            variant="secondary"
            icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}
            loading={busy === 'wa'}
            onClick={() => {
              // Open during the click so the browser doesn't treat it as a popup.
              const tab = window.open('', '_blank');
              void run('wa', async () => {
                const r = await brochureApi.text(property._id, opts);
                if (tab) {
                  tab.opener = null;
                  tab.location.href = r.whatsappUrl;
                } else window.location.href = r.whatsappUrl;
              }).catch(() => tab?.close());
            }}
          >
            WhatsApp
          </Button>
        </div>
        <p className="flex items-center gap-1 text-xs text-muted"><Download className="h-3 w-3" /> {t('brochure.imageHint')}</p>
      </div>
    </Modal>
  );
}
