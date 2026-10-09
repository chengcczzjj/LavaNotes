import { createRoot } from 'react-dom/client'
import { ManagerApp } from './ManagerApp'
import './manager.css'
import './stats.css'
import './ai.css'

createRoot(document.getElementById('root')!).render(<ManagerApp />)
