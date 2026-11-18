import { useCallback, useEffect, useState } from 'react'
import { fetchGoals } from '@/lib/goals'

// Fetches the user's goals once on mount. A hook rather than a shared
// store like TaskStoreContext: only two places read the goal list (the
// Goals page and the dashboard card), each re-mounts on navigation, and
// a goal's live progress on its own page comes from the task store — so
// a fresh fetch per mount is simpler than keeping a cache coherent.
export function useGoals() {
  const [goals, setGoals] = useState([])
  // 'loading' | 'ready' | 'error'
  const [status, setStatus] = useState('loading')

  const refresh = useCallback(() => {
    return fetchGoals()
      .then((data) => {
        setGoals(data.results)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { goals, status, refresh }
}
