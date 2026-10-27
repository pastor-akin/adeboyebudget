import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(outline: IconName, filled: IconName) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={focused ? filled : outline} size={24} color={color} />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopWidth: 0,
          height: 66,
          paddingTop: 6,
          paddingBottom: 8,
          shadowColor: '#1B2440',
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      {/* Home (index) is the first tab and the screen the app opens to. */}
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home-outline', 'home') }} />
      <Tabs.Screen name="expenses" options={{ title: 'Spending', tabBarIcon: tabIcon('receipt-outline', 'receipt') }} />
      <Tabs.Screen name="budgets" options={{ title: 'Budgets', tabBarIcon: tabIcon('pie-chart-outline', 'pie-chart') }} />
      <Tabs.Screen name="income" options={{ title: 'Income', tabBarIcon: tabIcon('wallet-outline', 'wallet') }} />
      <Tabs.Screen name="charts" options={{ title: 'Insights', tabBarIcon: tabIcon('stats-chart-outline', 'stats-chart') }} />
      {/* Reached from Home → Report and from Insights; not a tab of its own. */}
      <Tabs.Screen name="export" options={{ href: null }} />
    </Tabs>
  );
}
