export type Lang = 'en' | 'he'

export const translations = {
  en: {
    // Nav
    home: 'Home',
    predictions: 'Predictions',
    history: 'History',
    manage: 'Manage',
    pastDays: 'Past Days',
    addPastDay: 'Add Past Day',
    monthlyTrends: 'Monthly Trends',
    importData: 'Import Data',
    myProducts: 'My Products',
    myRegulars: 'My Regulars',
    recurringPatterns: 'Recurring Patterns',
    promosEvents: 'Promos & Events',
    predictionHistory: 'Prediction history',
    settings: 'Settings',
    logOut: 'Log out',

    // Tab titles
    tabHome: 'Know tomorrow, today.',
    tabPredictions: 'Predictions',
    tabTrends: 'Monthly trends & history',
    tabEvents: 'Promos & Events',
    tabProducts: 'My Products',
    tabRegulars: 'My Regulars',
    tabRecurring: 'Recurring Patterns',
    tabBackfill: 'Add a past day',
    tabHistory: 'Your past days',
    tabImport: 'Bring in your past data',
    tabSettings: 'Your business settings',
    tabPredHistory: 'How our predictions did',

    // Quick actions
    recordASale: 'Record a Sale',
    logToday: 'Log Today',
    recordARegular: 'Record a Regular',

    // Business / locations
    addBusiness: 'Add a business',
    addLocation: 'Add a location',
    freePlanLimit: 'Free plan: up to {n} businesses',
    freeOneLocation: 'Free plan: 1 location',
    upgradeForLocations: 'Upgrade to premium for multiple locations →',
    copyFromLocation: 'Copy settings & products from an existing location',
    startFresh: 'Start fresh',
    selectLocationToCopy: 'Which location to copy?',

    // Manage > Advanced planning
    advancedPlanning: 'Advanced planning',
    tabToolbox: 'Planning tools',

    // Errors
    retry: 'Retry',
    serverUnreachable: "Couldn't reach the server",
    checkConnection: 'Check your connection and try again.',

    // Slogan
    slogan: 'Know Tomorrow, Today.',

    // Tap-only banner
    tapRolloverTitle: "You have unsaved tap data for today",
    tapRolloverMsg: "You recorded sales by tapping today — don't forget to log today's totals.",
    tapRolloverAction: 'Log Today',
  },
  he: {
    // Nav
    home: 'בית',
    predictions: 'תחזיות',
    history: 'היסטוריה',
    manage: 'ניהול',
    pastDays: 'ימים קודמים',
    addPastDay: 'הוסף יום קודם',
    monthlyTrends: 'מגמות חודשיות',
    importData: 'ייבוא נתונים',
    myProducts: 'המוצרים שלי',
    myRegulars: 'הקבועים שלי',
    recurringPatterns: 'דפוסים חוזרים',
    promosEvents: 'מבצעים ואירועים',
    predictionHistory: 'היסטוריית תחזיות',
    settings: 'הגדרות',
    logOut: 'התנתק',

    // Tab titles
    tabHome: 'דע מחר, היום.',
    tabPredictions: 'תחזיות',
    tabTrends: 'מגמות והיסטוריה חודשית',
    tabEvents: 'מבצעים ואירועים',
    tabProducts: 'המוצרים שלי',
    tabRegulars: 'הקבועים שלי',
    tabRecurring: 'דפוסים חוזרים',
    tabBackfill: 'הוסף יום קודם',
    tabHistory: 'ימים קודמים',
    tabImport: 'ייבוא נתוני עבר',
    tabSettings: 'הגדרות העסק שלך',
    tabPredHistory: 'כיצד התחזיות שלנו התבצעו',

    // Quick actions
    recordASale: 'רשום מכירה',
    logToday: 'תעד היום',
    recordARegular: 'רשום לקוח קבוע',

    // Business / locations
    addBusiness: 'הוסף עסק',
    addLocation: 'הוסף סניף',
    freePlanLimit: 'תוכנית חינמית: עד {n} עסקים',
    freeOneLocation: 'תוכנית חינמית: סניף אחד',
    upgradeForLocations: 'שדרג לפרמיום לסניפים נוספים ←',
    copyFromLocation: 'העתק הגדרות ומוצרים מסניף קיים',
    startFresh: 'התחל מחדש',
    selectLocationToCopy: 'מאיזה סניף להעתיק?',

    // Manage > Advanced planning
    advancedPlanning: 'תכנון מתקדם',
    tabToolbox: 'כלי תכנון',

    // Errors
    retry: 'נסה שוב',
    serverUnreachable: 'לא ניתן להגיע לשרת',
    checkConnection: 'בדוק את החיבור שלך ונסה שוב.',

    // Slogan
    slogan: 'דע מחר, היום.',

    // Tap-only banner
    tapRolloverTitle: 'יש לך נתוני הקשה שלא נשמרו להיום',
    tapRolloverMsg: 'רשמת מכירות על ידי הקשה היום — אל תשכח לתעד את סיכום היום.',
    tapRolloverAction: 'תעד היום',
  },
} as const satisfies Record<Lang, Record<string, string>>

export type TranslationKey = keyof (typeof translations)['en']
