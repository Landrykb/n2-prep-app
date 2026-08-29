import { useContext } from 'react'
import { KanjiModalContext } from '../lib/kanjiModalContext.js'

export const useKanjiModal = () => useContext(KanjiModalContext)
