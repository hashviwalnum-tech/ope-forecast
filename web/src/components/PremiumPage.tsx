import { useState, useEffect, useCallback } from 'react'
import LoadError from './LoadError'
import { useLanguage } from '../contexts/LanguageContext'
import * as api from '../api/client'
import type { SubscriptionRead } from '../api/types'
import { PLAY_LISTING_URL, PLAY_MANAGE_URL } from '../lib/googlePlay'

const FREE_FEATURES = [
  'premiumFreeItem1',
  'premiumFreeItem2',
  'premiumFreeItem3',
  'premiumFreeItem4',
  'premiumFreeItem5',
  'premiumFreeItem6',
  'premiumFreeItem7',
] as const

const PREMIUM_FEATURES = [
  'premiumPaidItem1',
  'premiumPaidItem2',
  'premiumPaidItem3',
  'premiumPaidItem4',
  'premiumPaidItem5',
  'premiumPaidItem6',
] as const

export default function PremiumPage() {
  const { t, lang } = useLanguage()
  const locale = lang

  const [sub, setSub] = useState<SubscriptionRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const loadSub = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.subscription.get()
      setSub(data)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSub() }, [loadSub])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-teal-600 dark:text-teal-300 text-sm">{t('loadingLabel')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <LoadError error={error} onRetry={loadSub} variant="inline" />
        <button
          onClick={loadSub}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 transition-colors"
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  const isPremium = sub?.effective_tier === 'premium'
  const status = sub?.subscription_status ?? 'none'
  const onPlay = sub?.subscription_provider === 'google_play'
  // Paying through Google Play and still entitled — renewing, in grace, or
  // cancelled but paid up to a date.
  const isActive = onPlay && isPremium && ['active', 'grace', 'cancelled'].includes(status)
  const isTrial = sub?.tier === 'trial' && isPremium && !isActive
  const isGranted = !!sub?.manual_grant && isPremium && !isActive && !isTrial
  const daysLeft = sub?.trial_days_remaining
  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(locale) : null
  const paidThrough = fmtDate(sub?.renewal_at)
  const grantEnds = fmtDate(sub?.manual_grant_ends_at)
  // A Play subscription that still needs the owner's attention in Google Play.
  const paymentProblem = onPlay && ['grace', 'on_hold'].includes(status)

  function statusLine(): string {
    if (isActive && status === 'cancelled' && paidThrough) return t('premiumCancelledUntil', { date: paidThrough })
    if (isActive) return t('premiumActiveSubscription')
    if (isTrial && daysLeft !== null && daysLeft !== undefined && daysLeft > 0)
      return t('premiumTrialEndsIn', { n: daysLeft, s: daysLeft === 1 ? '' : 's' })
    if (isGranted) return grantEnds ? t('premiumGrantedUntil', { date: grantEnds }) : t('premiumGranted')
    if (sub?.tier === 'trial') return t('premiumTrialEnded')
    return t('premiumFreeAccount')
  }

  function statusBadge() {
    if (isActive || isGranted) return { label: t('premiumStatusBadgePremium'), cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' }
    if (isTrial) return { label: t('premiumStatusBadgeTrial'), cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-50' }
    return { label: t('premiumStatusBadgeFree'), cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
  }

  const badge = statusBadge()

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* Status card */}
      <div className={`rounded-2xl border-2 p-6 ${
        isPremium
          ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'
          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${badge.cls}`}>
              {badge.label}
            </span>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {statusLine()}
            </p>
            {isTrial && (
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('premiumTrialActive')}</p>
            )}
            {isActive && status === 'active' && paidThrough && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {t('premiumRenewalDate', { date: paidThrough })}
              </p>
            )}
            {paymentProblem && (
              <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
                {t('premiumPaymentProblem')}
              </p>
            )}
          </div>
          <svg
            className={`w-8 h-8 shrink-0 ${isPremium ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}`}
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </div>
      </div>

      {/* Feature comparison */}
      <div className="grid md:grid-cols-2 gap-6">

        {/* Free features */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
          {/* h2, not h3: the page's h1 is the tab title in App, and jumping
              straight to h3 leaves a screen reader's heading list with a gap
              where the two plan columns should sit. */}
          <h2 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-4">
            {t('premiumFreeFeatures')}
          </h2>
          <ul className="space-y-2.5">
            {FREE_FEATURES.map(key => (
              <li key={key} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-teal-700 mt-0.5 shrink-0 dark:text-teal-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-slate-700 dark:text-slate-200">{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Premium features */}
        <div className={`rounded-2xl border p-5 ${
          isPremium
            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
        }`}>
          <h2 className="text-sm font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-4">
            {t('premiumPremiumFeatures')}
          </h2>
          <ul className="space-y-2.5">
            {PREMIUM_FEATURES.map(key => (
              <li key={key} className="flex items-start gap-2.5">
                {isPremium ? (
                  <svg className="w-4 h-4 text-amber-700 mt-0.5 shrink-0 dark:text-amber-300" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-slate-600 mt-0.5 shrink-0 dark:text-slate-300" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                )}
                <span className={`text-sm ${isPremium ? 'text-amber-800 dark:text-amber-200' : 'text-slate-600 dark:text-slate-400'}`}>
                  {t(key)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Where Premium comes from. The web never sells it — it can only
          point to the Android app, where Google Play handles payment. No
          price here, and no purchase flow. */}
      {!isPremium && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{t('premiumAndroidTitle')}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{t('premiumAndroidBody')}</p>
          <a
            href={PLAY_LISTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-5 min-h-11 rounded-xl text-sm font-semibold
                       bg-teal-600 hover:bg-teal-700 text-white transition-colors
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            {t('premiumGetOnPlay')}
          </a>
        </div>
      )}

      {/* Managing a Play subscription happens in Google Play, not here. */}
      {onPlay && (isActive || paymentProblem) && (
        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('premiumManageBilling')}</h3>
          <a
            href={PLAY_MANAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm font-medium text-teal-700 dark:text-teal-300 underline underline-offset-2 min-h-11"
          >
            {t('premiumManageOnPlay')}
          </a>
        </div>
      )}

    </div>
  )
}
