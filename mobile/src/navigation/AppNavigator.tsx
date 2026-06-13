import { useColorScheme } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Ionicons } from '@expo/vector-icons'
import { light, dark } from '../lib/theme'
import LogScreen from '../screens/LogScreen'
import ForecastScreen from '../screens/ForecastScreen'
import AnalyticsScreen from '../screens/AnalyticsScreen'
import ManageScreen from '../screens/ManageScreen'

const Tab = createBottomTabNavigator()

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

const TAB_ICONS: Record<string, { outline: IoniconsName; filled: IoniconsName }> = {
  Log:       { outline: 'add-circle-outline', filled: 'add-circle' },
  Forecast:  { outline: 'calendar-outline',   filled: 'calendar' },
  Analytics: { outline: 'bar-chart-outline',  filled: 'bar-chart' },
  Manage:    { outline: 'settings-outline',   filled: 'settings' },
}

export default function AppNavigator() {
  const scheme = useColorScheme()
  const c = scheme === 'dark' ? dark : light

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
        <Tab.Screen name="Log" component={LogScreen} />
        <Tab.Screen name="Forecast" component={ForecastScreen} />
        <Tab.Screen name="Analytics" component={AnalyticsScreen} />
        <Tab.Screen name="Manage" component={ManageScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  )
}
