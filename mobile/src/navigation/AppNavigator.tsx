import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../contexts/ThemeContext'
import { useSettingsSheet } from '../contexts/SettingsContext'
import { useBusiness } from '../contexts/BusinessContext'
import { useLanguage } from '../contexts/LanguageContext'
import LogScreen from '../screens/LogScreen'
import ForecastScreen from '../screens/ForecastScreen'
import AnalyticsScreen from '../screens/AnalyticsScreen'
import ManageScreen from '../screens/ManageScreen'
import SettingsModal from '../screens/manage/SettingsModal'

const Tab = createBottomTabNavigator()

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

const TAB_ICONS: Record<string, { outline: IoniconsName; filled: IoniconsName }> = {
  Log:       { outline: 'add-circle-outline', filled: 'add-circle' },
  Forecast:  { outline: 'calendar-outline',   filled: 'calendar' },
  Analytics: { outline: 'bar-chart-outline',  filled: 'bar-chart' },
  Manage:    { outline: 'grid-outline',        filled: 'grid' },
}

export default function AppNavigator() {
  const c = useTheme()
  const { settingsOpen, closeSettings } = useSettingsSheet()
  const { business, reload } = useBusiness()
  const { t } = useLanguage()

  return (
    <NavigationContainer>
      <Tab.Navigator
        initialRouteName="Log"
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: {
            backgroundColor: c.tabBg,
            borderTopColor: c.tabBorder,
            borderTopWidth: 1,
          },
          tabBarActiveTintColor: c.tabActive,
          tabBarInactiveTintColor: c.tabInactive,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarIcon: ({ color, size, focused }) => {
            const icons = TAB_ICONS[route.name]
            const name = focused ? icons.filled : icons.outline
            return <Ionicons name={name} size={size} color={color} />
          },
        })}
      >
        <Tab.Screen name="Log" component={LogScreen} options={{ tabBarLabel: t('log') }} />
        <Tab.Screen name="Forecast" component={ForecastScreen} options={{ tabBarLabel: t('forecast') }} />
        <Tab.Screen name="Analytics" component={AnalyticsScreen} options={{ tabBarLabel: t('analytics') }} />
        <Tab.Screen name="Manage" component={ManageScreen} options={{ tabBarLabel: t('manage') }} />
      </Tab.Navigator>

      {/* Global settings sheet — opened by the gear icon in any screen's header */}
      {settingsOpen && business !== null && (
        <SettingsModal
          business={business}
          onClose={closeSettings}
          onSaved={async () => { await reload() }}
        />
      )}
    </NavigationContainer>
  )
}
