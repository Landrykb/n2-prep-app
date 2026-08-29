import { useContext } from 'react'
import { AuthContext } from '../lib/authContext.js'

export const useAuth = () => useContext(AuthContext)
