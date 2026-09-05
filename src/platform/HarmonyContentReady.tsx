import { useEffect } from 'react'

/**
 * Acknowledge native-shell content readiness only after React commits.
 * Module initialization has a separate handshake for launch dispatch.
 */
export function HarmonyContentReady() {
  useEffect(() => {
    window.harmonyBridge?.notifyWebContentReady()
  }, [])

  return null
}
