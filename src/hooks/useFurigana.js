import { useContext } from 'react'
import { FuriganaContext } from '../lib/furiganaContext.js'

export function useFurigana() {
  const ctx = useContext(FuriganaContext)
  if (!ctx) throw new Error('useFurigana must be used within a FuriganaProvider')
  return ctx
}
