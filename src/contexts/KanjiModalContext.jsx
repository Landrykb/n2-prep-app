import { useState } from 'react'
import { KanjiModalContext } from '../lib/kanjiModalContext.js'
import KanjiModal from '../components/KanjiModal.jsx'

export const KanjiModalProvider = ({ children }) => {
  const [item, setItem] = useState(null)
  const open = (next) => setItem(next)
  const close = () => setItem(null)

  return (
    <KanjiModalContext.Provider value={{ open, close, item }}>
      {children}
      {item && <KanjiModal item={item} onClose={close} />}
    </KanjiModalContext.Provider>
  )
}
