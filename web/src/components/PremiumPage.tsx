import { useState, useEffect, useCallback } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import * as api from '../api/client'
import type { SubscriptionRead } from '../api/types'

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
  const { t } = useLanguage()

  const [sub, setSub] = useState<SubscriptionRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState<'monthly' | 'annual' | null>(null)
  const [testComplete, setTestComplete] = useState(false)

  const loadSub = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.subscription.get()
      setSub(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('premiumLoadingError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { loadSub() }, [loadSub])

  // Detect stub checkout completion: current page URL has ?stub=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('stub') === '1') {
      setTestComplete(true)
      // Clean up the URL
      const clean = window.location.pathname
      window.history.replaceState({}, '', clean)
      loadSub()
    }
  }, [loadSub])

  async function handleCheckout(plan: 'monthly' | 'annual') {
    setCheckingOut(plan)
    try {
      const successUrl = window.location.href.split('?')[0]
      const cancelUrl = window.location.href.split('?')[0]
      const result = await api.subscription.startCheckout(plan, successUrl, cancelUrl)
      window.location.href = result.checkout_url
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Checkout failed')
    } finally {
      setCheckingOut(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-teal-600 dark:text-teal-400 text-sm">{t('loadingLabel')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <p className="text-slate-600 dark:text-slate-300 text-sm">{error}</p>
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
  const isActive = sub?.subscription_status === 'active'
  const isTrial = sub?.tier === 'trial' && isPremium
  const daysLeft = sub?.trial_days_remaining
  const renewalDate = sub?.renewal_at
    ? new Date(sub.renewal_at).toLocaleDateString()
    : null

  function statusBadge() {
    if (isActive) return { label: t('premiumStatusBadgePremium'), cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' }
    if (isTrial) return { label: t('premiumStatusBadgeTrial'), cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' }
    return { label: t('premiumStatusBadgeFree'), cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
  }

  const badge = statusBadge()

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* Test-mode success banner */}
      {testComplete && (
        <div className="rounded-xl bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700 px-5 py-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-teal-800 dark:text-teal-200 font-medium">{t('premiumTestComplete')}</p>
        </div>
      )}

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
              {isActive
                ? t('premiumActiveSubscription')
                : isTrial && daysLeft !== null && daysLeft !== undefined && daysLeft > 0
                  ? t('premiumTrialEndsIn', { n: daysLeft, s: daysLeft === 1 ? '' : 's' })
                  : isTrial
                    ? t('premiumTrialEnded')
                    : t('premiumFreeAccount')
              }
            </p>
            {isTrial && (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('premiumTrialActive')}</p>
            )}
            {isActive && renewalDate && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {t('premiumRenewalDate', { date: renewalDate })}
              </p>
            )}
          </div>
          <svg
            className={`w-8 h-8 shrink-0 ${isPremium ? 'text-amber-500' : 'text-slate-400'}`}
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
          <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            {t('premiumFreeFeatures')}
          </h3>
          <ul className="space-y-2.5">
            {FREE_FEATURES.map(key => (
              <li key={key} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-teal-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
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
          <h3 className="text-sm font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-4">
            {t('premiumPremiumFeatures')}
          </h3>
          <ul className="space-y-2.5">
            {PREMIUM_FEATURES.map(key => (
              <li key={key} className="flex items-start gap-2.5">
                {isPremium ? (
                  <svg className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                )}
                <span className={`text-sm ${isPremium ? 'text-amber-800 dark:text-amber-200' : 'text-slate-500 dark:text-slate-400'}`}>
                  {t(key)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Upgrade section — only shown when not already a paying subscriber */}
      {!isActive && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{t('premiumUpgradeTitle')}</h2>

          <p className="text-sm text-slate-500 dark:text-slate-400">{t('premiumBillingNote')}</p>

          <div className="grid sm:grid-cols-2 gap-4">
            {/* Monthly */}
            <button
              onClick={() => handleCheckout('monthly')}
              disabled={checkingOut !== null}
              className="flex flex-col items-center gap-1 p-5 rounded-xl border-2 border-teal-500 bg-teal-50 dark:bg-teal-900/20 dark:border-teal-600
                         hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors disabled:opacity-60"
            >
              <span className="text-xl font-bold text-teal-700 dark:text-teal-300">{t('premiumMonthlyPlan')}</span>
              <span className="text-sm font-semibold text-teal-600 dark:text-teal-400">
                {checkingOut === 'monthly' ? t('loadingLabel') : t('premiumUpgradeMonthly')}
              </span>
            </button>

            {/* Annual */}
            <button
              onClick={() => handleCheckout('annual')}
              disabled={checkingOut !== null}
              className="flex flex-col items-center gap-1 p-5 rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-600
                         hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-60 relative"
            >
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 dark:bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                {t('premiumAnnualSave')}
              </span>
              <span className="text-xl font-bold text-amber-700 dark:text-amber-300">{t('premiumAnnualPlan')}</span>
              <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                {checkingOut === 'annual' ? t('loadingLabel') : t('premiumUpgradeAnnual')}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Manage billing note — for active subscribers */}
      {isActive && (
        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">{t('premiumManageBilling')}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('premiumManageBillingNote')}</p>
        </div>
      )}

    </div>
  )
}
