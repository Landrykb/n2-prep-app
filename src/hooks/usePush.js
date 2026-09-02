import { useEffect, useState } from 'react'
import { useAuth } from './useAuth.js'
import { savePushSubscription, deletePushSubscription } from '../lib/supabaseApi.js'
import { supabase } from '../lib/supabaseClient.js'

const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function usePush() {
  const { user } = useAuth()
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [permission, setPermission] = useState(Notification?.permission || 'default')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && !!publicKey
    setSupported(ok)
    if (!ok) return
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
    })
    setPermission(Notification.permission)
  }, [])

  const requestPermission = async () => {
    if (!('Notification' in window)) return 'denied'
    const p = await Notification.requestPermission()
    setPermission(p)
    return p
  }

  const subscribe = async () => {
    if (!supported || !user) return false
    const p = await requestPermission()
    if (p !== 'granted') return false
    try {
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }
      await savePushSubscription(user.id, sub.toJSON())
      setSubscribed(true)
      return true
    } catch (err) {
      console.error('Push subscribe error:', err)
      return false
    }
  }

  const unsubscribe = async () => {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await sub.unsubscribe()
      if (user && supabase) await deletePushSubscription(user.id, sub.endpoint)
    }
    setSubscribed(false)
  }

  const sendTest = async () => {
    const reg = await navigator.serviceWorker.ready
    if (!reg) return
    reg.showNotification('JPN2easy test', {
      body: 'Your push setup is working! 🎉',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'test',
      data: { url: '/' },
    })
  }

  const sendPushFromApp = async (title, body, url = '/') => {
    if (!user || !supabase) return false
    const { data, error } = await supabase.functions.invoke('push-send', {
      body: { title, body, url, tag: 'manual' },
    })
    if (error) {
      console.error('push-send error:', error)
      return false
    }
    return data
  }

  return { supported, subscribed, permission, subscribe, unsubscribe, requestPermission, sendTest, sendPushFromApp }
}
