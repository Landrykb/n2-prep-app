import { createContext } from 'react'

export const KanjiModalContext = createContext({
  open: () => {},
  close: () => {},
  item: null,
})
