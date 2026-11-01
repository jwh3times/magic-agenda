/**
 * What this device and browser are, in one place, so Push availability (`pushGateway`) and install
 * guidance (`install/guidance`) can't disagree. These only choose which explanation to show. Whether
 * Push can actually run is still feature detection, in the gateway.
 */
export interface Platform {
  /** iPhone or iPad, including an iPad asking for desktop sites. */
  ios: boolean
  /** Running as the installed app rather than in a browser tab. */
  standalone: boolean
  /** Inside another app's built-in browser, which can't install anything. */
  inAppBrowser: boolean
}

export function isIosDevice(agent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(agent) || (agent.includes('Mac') && maxTouchPoints > 1)
}

const NAMED_IN_APP_BROWSER =
  /FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|Snapchat|musical_ly|BytedanceWebview|TikTok|MicroMessenger|Pinterest|Twitter|GSA\//

/**
 * From the user agent alone, so an app that names itself nowhere can still be missed. Two generic
 * marks catch most of those: Android marks a web view with `wv`, and an iOS web view has no
 * `Safari/` token, which the real browsers there all send. The installed app has no such token
 * either, so a caller checks `standalone` first.
 */
export function isInAppBrowser(agent: string, maxTouchPoints: number): boolean {
  if (NAMED_IN_APP_BROWSER.test(agent) || /; wv\)/.test(agent)) return true
  return isIosDevice(agent, maxTouchPoints) && !agent.includes('Safari/')
}

function readPlatform(): Platform {
  if (typeof navigator === 'undefined') {
    return { ios: false, standalone: false, inAppBrowser: false }
  }
  return {
    ios: isIosDevice(navigator.userAgent, navigator.maxTouchPoints),
    standalone:
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches,
    inAppBrowser: isInAppBrowser(navigator.userAgent, navigator.maxTouchPoints),
  }
}

export const browserPlatform = readPlatform()
