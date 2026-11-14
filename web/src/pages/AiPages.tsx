import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Copy, Gauge, MessageCircle, Send, Sparkles, TrendingUp, Wand2 } from 'lucide-react';
import { PERMISSIONS, whatsappLink } from '@recrm/shared';
import { aiApi, propertyApi } from '@/api/endpoints';
import type { Property } from '@/api/types';
import { Badge, Button, Card, MetricTile, Modal, PageHeader, Segmented, Textarea, type BadgeColor } from '@/components/ui';
import { formatPkr } from '@/lib/format';
import { useErrorText, useOnError } from '@/lib/hooks';
import { useCan, useModule } from '@/store/auth';
import { toast } from '@/store/toast';

const CONFIDENCE: Record<string, BadgeColor> = { HIGH: 'green', MEDIUM: 'amber', LOW: 'gray' };

/** Minimal, safe rendering of the assistant's markdown-ish answer (bold + bullets + paragraphs; no HTML). */
function Answer({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {text.split('\n').map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line);
        const body = line.replace(/^\s*[-*•]\s+/, '');
        const parts = body.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>));
        if (!line.trim()) return <div key={i} className="h-1" />;
        return bullet ? <p key={i} className="flex gap-2"><span className="text-muted">•</span><span>{parts}</span></p> : <p key={i}>{parts}</p>;
      })}
    </div>
  );
}

/* ═════════════ Assistant page ═════════════ */

type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[] };

export function AssistantPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const status = useQuery({ queryKey: ['ai', 'status'], queryFn: aiApi.status });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const ask = useMutation({
    mutationFn: (history: Turn[]) => aiApi.assistant(history.map(({ role, content }) => ({ role, content }))),
    onSuccess: (r) => setTurns((x) => [...x, { role: 'assistant', content: r.answer, tools: r.toolsUsed }]),
    onError: (e) => setTurns((x) => [...x, { role: 'assistant', content: `⚠ ${errorText(e)}` }]),
  });
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, ask.isPending]);
  const send = (q: string) => {
    const text = q.trim();
    if (!text || ask.isPending) return;
    // Failed turns (⚠) are not sent back to the model.
    const history = [...turns.filter((x) => !x.content.startsWith('⚠')), { role: 'user' as const, content: text }];
    setTurns((x) => [...x, { role: 'user', content: text }]);
    setInput('');
    ask.mutate(history);
  };
  const s = status.data;
  const suggestions = [t('ai.q1'), t('ai.q2'), t('ai.q3'), t('ai.q4')];
  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-3xl flex-col">
      <PageHeader
        title={<span className="flex items-center gap-2"><Bot className="h-6 w-6 text-brand-600" />{t('ai.title')}</span>}
        subtitle={t('ai.subtitle')}
        actions={s && <Badge color={s.configured ? 'green' : 'gray'}>{s.configured ? t('ai.usage', { used: s.usedThisMonth, limit: s.monthlyLimit }) : t('ai.off')}</Badge>}
      />
      {s && !s.configured && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{t('ai.notConfigured')}</p>}
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-4">
        {!turns.length && (
          <div className="py-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-brand-500" />
            <p className="mt-2 text-sm text-muted">{t('ai.intro')}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {suggestions.map((q) => <button key={q} type="button" disabled={!s?.configured} className="chip ring-1 ring-inset ring-line hover:bg-surface-2 disabled:opacity-50" onClick={() => send(q)}>{q}</button>)}
            </div>
          </div>
        )}
        {turns.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.role === 'user' ? 'bg-brand-600 text-on-brand' : 'bg-surface-2'}`}>
              {m.role === 'user' ? <p className="whitespace-pre-wrap text-sm">{m.content}</p> : <Answer text={m.content} />}
              {!!m.tools?.length && <p className="mt-1.5 text-2xs text-muted">{t('ai.looked', { tools: m.tools.map((x) => t(`ai.tool.${x}`, { defaultValue: x })).join(', ') })}</p>}
            </div>
          </div>
        ))}
        {ask.isPending && <div className="flex"><div className="rounded-2xl bg-surface-2 px-4 py-2.5 text-sm text-muted">{t('ai.thinking')}</div></div>}
        <div ref={end} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e: FormEvent) => (e.preventDefault(), send(input))}>
        <Textarea aria-label={t('ai.placeholder')} wrapperClassName="flex-1" rows={2} placeholder={t('ai.placeholder')} value={input} disabled={!s?.configured} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), send(input)); }} />
        <Button type="submit" className="self-end" loading={ask.isPending} disabled={!input.trim() || !s?.configured} icon={<Send className="h-4 w-4" />}>{t('ai.ask')}</Button>
      </form>
      <p className="mt-1.5 text-2xs text-muted">{t('ai.privacy')}</p>
    </div>
  );
}

/* ═════════════ Property: price estimate + description writer ═════════════ */

export function PropertyAiPanel({ property }: { property: Property }) {
  const { t } = useTranslation();
  const hasAi = useModule('ai');
  const canEdit = useCan(PERMISSIONS.PROPERTIES_UPDATE);
  const est = useQuery({ queryKey: ['ai', 'price', property._id, property.askingPrice], queryFn: () => aiApi.priceEstimate(property._id), enabled: hasAi });
  const [writing, setWriting] = useState(false);
  if (!hasAi) return null;
  const e = est.data;
  return (
    <Card
      className="mb-4"
      title={<span className="flex items-center gap-2"><Gauge className="h-4 w-4 text-brand-600" />{t('ai.priceTitle')}</span>}
      actions={canEdit && <Button size="sm" variant="secondary" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => setWriting(true)}>{t('ai.writeDescription')}</Button>}
    >
      {!e ? (
        <div className="h-10 animate-pulse rounded bg-surface-2" />
      ) : e.mid === null || e.mid === undefined ? (
        <p className="text-sm text-muted">{e.disclaimer}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="ltr-nums text-lg font-bold">{formatPkr(e.low!)} – {formatPkr(e.high!)}</p>
            <p className="ltr-nums text-xs text-muted">{t('ai.midpoint', { mid: formatPkr(e.mid), rate: formatPkr(e.perSqft!) })}</p>
          </div>
          <Badge color={e.position === 'WITHIN' ? 'green' : 'amber'}>{t(`ai.position.${e.position}`)}</Badge>
          <Badge color={CONFIDENCE[e.confidence!]}>{t(`ai.confidence.${e.confidence}`)}</Badge>
          <p className="w-full text-2xs text-muted">{t('ai.basedOn', { count: e.comparables, sold: e.sold, scope: e.scope })} · {e.disclaimer}</p>
        </div>
      )}
      {writing && <DescriptionModal property={property} onClose={() => setWriting(false)} />}
    </Card>
  );
}

function DescriptionModal({ property, onClose }: { property: Property; onClose(): void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useOnError();
  const [lang, setLang] = useState<'en' | 'ur'>('en');
  const [draft, setDraft] = useState<{ headline: string; description: string; source: string } | null>(null);
  const gen = useMutation({ mutationFn: () => aiApi.describe(property._id, lang), onSuccess: setDraft, onError });
  const apply = useMutation({
    mutationFn: () => propertyApi.update(property._id, { title: draft!.headline.slice(0, 150), description: draft!.description, baseVersion: property.version }),
    onSuccess: () => (toast.success(t('ai.applied')), void qc.invalidateQueries({ queryKey: ['property', property._id] }), onClose()),
    onError,
  });
  return (
    <Modal open onClose={onClose} size="lg" title={t('ai.writeDescription')} footer={
      <>
        <Button variant="secondary" loading={gen.isPending} icon={<Sparkles className="h-4 w-4" />} onClick={() => gen.mutate()}>{draft ? t('ai.again') : t('ai.generate')}</Button>
        {draft && <Button loading={apply.isPending} onClick={() => apply.mutate()}>{t('ai.useThis')}</Button>}
      </>
    }>
      <div className="mb-3 flex items-center gap-3">
        <Segmented options={[{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو' }]} value={lang} onChange={setLang} />
        <span className="text-xs text-muted">{t('ai.descriptionHint')}</span>
      </div>
      {draft ? (
        <div className="space-y-2" dir={lang === 'ur' ? 'rtl' : undefined}>
          <input className="input w-full font-semibold" value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} aria-label={t('marketing.headline')} />
          <Textarea rows={7} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label={t('property.description')} />
          <p className="text-2xs text-muted">{draft.source === 'ai' ? t('ai.sourceAi') : t('ai.sourceTemplate')}</p>
        </div>
      ) : (
        <p className="text-sm text-muted">{t('ai.descriptionIntro')}</p>
      )}
    </Modal>
  );
}

/* ═════════════ Client brief ═════════════ */

export function ClientBriefCard({ clientId, phone }: { clientId: string; phone?: string | null }) {
  const { t, i18n } = useTranslation();
  const hasAi = useModule('ai');
  const onError = useOnError();
  const brief = useMutation({ mutationFn: () => aiApi.brief(clientId, i18n.language === 'ur' ? 'ur' : 'en'), onError });
  if (!hasAi) return null;
  const b = brief.data;
  return (
    <Card
      className="mb-4"
      title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-600" />{t('ai.briefTitle')}</span>}
      actions={<Button size="sm" variant="secondary" loading={brief.isPending} onClick={() => brief.mutate()}>{b ? t('ai.refresh') : t('ai.getBrief')}</Button>}
    >
      {!b ? (
        <p className="text-sm text-muted">{t('ai.briefIntro')}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <p>{b.summary}</p>
            <p><span className="font-semibold">{t('ai.nextAction')}:</span> {b.nextAction}</p>
            {!!b.risks.length && <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">{b.risks.map((r) => <li key={r}>⚠ {r}</li>)}</ul>}
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="mb-1 text-xs font-semibold text-muted">{t('ai.suggestedMessage')}</p>
            <p className="whitespace-pre-wrap text-sm">{b.message}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void navigator.clipboard.writeText(b.message).then(() => toast.success(t('common.copied')))}>{t('common.copy')}</Button>
              {phone && <Button size="sm" icon={<MessageCircle className="h-3.5 w-3.5" />} onClick={() => window.open(whatsappLink(phone, b.message), '_blank', 'noopener')}>WhatsApp</Button>}
            </div>
          </div>
          <p className="text-2xs text-muted md:col-span-2">{b.source === 'ai' ? t('ai.sourceAi') : t('ai.sourceRules')}</p>
        </div>
      )}
    </Card>
  );
}

/* ═════════════ Forecast (Reports page) ═════════════ */

export function ForecastCard() {
  const { t } = useTranslation();
  const hasAi = useModule('ai');
  const q = useQuery({ queryKey: ['ai', 'forecast'], queryFn: aiApi.forecast, enabled: hasAi });
  if (!hasAi || q.isError) return null;
  const d = q.data;
  const max = Math.max(1, ...(d?.months ?? []).map((m) => m.weighted + m.installments + m.rent));
  return (
    <Card title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-brand-600" />{t('ai.forecastTitle')}</span>}>
      {!d ? (
        <div className="h-32 animate-pulse rounded bg-surface-2" />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile tone="brand" label={t('ai.weightedCommission')} value={formatPkr(d.totals.weightedCommission)} />
            <MetricTile label={t('ai.bestCase')} value={formatPkr(d.totals.bestCaseCommission)} />
            <MetricTile tone="good" label={t('ai.installmentsDue')} value={formatPkr(d.totals.installments)} />
            <MetricTile tone="good" label={t('ai.rentDue')} value={formatPkr(d.totals.rent)} />
          </div>
          <div className="space-y-1.5">
            {d.months.map((m) => (
              <div key={m.month} className="grid grid-cols-[4rem_1fr_7rem] items-center gap-2 text-xs">
                <span className="ltr-nums text-muted">{m.month}</span>
                <span className="flex h-3 overflow-hidden rounded-full bg-surface-2" title={`${formatPkr(m.weighted)} · ${formatPkr(m.installments)} · ${formatPkr(m.rent)}`}>
                  <span className="bg-brand-500" style={{ width: `${(m.weighted / max) * 100}%` }} />
                  <span className="bg-emerald-500" style={{ width: `${(m.installments / max) * 100}%` }} />
                  <span className="bg-teal-300" style={{ width: `${(m.rent / max) * 100}%` }} />
                </span>
                <span className="ltr-nums text-end font-medium">{formatPkr(m.weighted + m.installments + m.rent)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 flex flex-wrap gap-3 text-2xs text-muted">
            <span><span className="me-1 inline-block h-2 w-2 rounded-full bg-brand-500" />{t('ai.legendCommission')}</span>
            <span><span className="me-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />{t('ai.legendInstallments')}</span>
            <span><span className="me-1 inline-block h-2 w-2 rounded-full bg-teal-300" />{t('ai.legendRent')}</span>
            {d.expectedLeadsNextMonth > 0 && <span>· {t('ai.expectedLeads', { count: d.expectedLeadsNextMonth })}</span>}
          </p>
          <p className="mt-1 text-2xs text-muted">{t('ai.forecastMethod')}</p>
        </>
      )}
    </Card>
  );
}
