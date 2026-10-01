// Premium is bought only inside the Ope Android app, through Google Play.
// The web app never sells anything: it may point to the Play listing (this is
// our own website, and the link leads to Google's billing, not away from it),
// and to Google's own page for managing a subscription.
export const PLAY_PACKAGE = 'com.opeforecast.app'
export const PLAY_PRODUCT_ID = 'ope_premium'
export const PLAY_LISTING_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`
export const PLAY_MANAGE_URL =
  `https://play.google.com/store/account/subscriptions?sku=${PLAY_PRODUCT_ID}&package=${PLAY_PACKAGE}`
