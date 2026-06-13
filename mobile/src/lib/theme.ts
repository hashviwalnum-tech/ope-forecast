import { useColorScheme } from 'react-native'

export const light = {
  bg: '#f0fdfa',
  headerBg: '#0d9488',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  textSub: '#64748b',
  textMuted: '#94a3b8',
  onPrimary: '#ffffff',
  onPrimarySub: '#ccfbf1',
  primary: '#0d9488',
  primaryDark: '#0f766e',
  primaryBg: '#ccfbf1',
  primaryXBg: '#f0fdfa',
  tabBg: '#ffffff',
  tabBorder: '#e2e8f0',
  tabActive: '#0d9488',
  tabInactive: '#94a3b8',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
}

export const dark = {
  bg: '#091515',
  headerBg: '#0d2c2c',
  card: '#162828',
  border: '#223636',
  text: '#e2e8f0',
  textSub: '#94a3b8',
  textMuted: '#64748b',
  onPrimary: '#ffffff',
  onPrimarySub: '#5eead4',
  primary: '#0d9488',
  primaryDark: '#5eead4',
  primaryBg: '#163535',
  primaryXBg: '#0d2020',
  tabBg: '#0d1c1c',
  tabBorder: '#162828',
  tabActive: '#5eead4',
  tabInactive: '#496060',
  danger: '#f87171',
  dangerBg: '#291818',
}

export type Theme = typeof light

export function useTheme(): Theme {
  const scheme = useColorScheme()
  return scheme === 'dark' ? dark : light
}
